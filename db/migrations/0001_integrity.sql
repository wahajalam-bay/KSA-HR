-- ════════════════════════════════════════════════════════════════════════════
--  Integrity: the guarantees the browser prototype could not make.
--
--  Everything here is enforced by the database rather than by the code that
--  happens to be calling it, because "the application always does X" stops
--  being true the moment a worker, a webhook or a console does not.
-- ════════════════════════════════════════════════════════════════════════════

-- ── updated_at ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I; CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION touch_updated_at()',
      t || '_touch', t, t || '_touch', t);
  END LOOP;
END $$;

-- ── Append-only tables ───────────────────────────────────────────────────────
--  The audit trail, the domain event log and an application's stage history are
--  records of what happened. Nothing may edit or erase them — not the
--  application, not a migration, not a console. A correction is a new row.
CREATE OR REPLACE FUNCTION refuse_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Record a new row instead; the history is the record.';
END $$;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

CREATE TRIGGER application_stage_history_append_only
  BEFORE UPDATE OR DELETE ON application_stage_history
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

CREATE TRIGGER offer_letter_edits_append_only
  BEFORE UPDATE OR DELETE ON offer_letter_edits
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

CREATE TRIGGER login_attempts_append_only
  BEFORE UPDATE OR DELETE ON login_attempts
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

CREATE TRIGGER file_access_log_append_only
  BEFORE UPDATE OR DELETE ON file_access_log
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

--  domain_events is append-only in substance but the dispatcher stamps
--  dispatched_at, so only that column may move, and only from NULL.
CREATE OR REPLACE FUNCTION domain_events_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'domain_events is append-only: DELETE is not allowed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at THEN
    RAISE EXCEPTION 'domain_events.dispatched_at is set once'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.type, NEW.subject_type, NEW.subject_id, NEW.payload, NEW.at)
     IS DISTINCT FROM (OLD.id, OLD.type, OLD.subject_type, OLD.subject_id, OLD.payload, OLD.at) THEN
    RAISE EXCEPTION 'domain_events is append-only: only dispatched_at may be set'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER domain_events_guard_trg
  BEFORE UPDATE OR DELETE ON domain_events
  FOR EACH ROW EXECUTE FUNCTION domain_events_guard();

-- ── Stage history: the sequence, assigned by the database ───────────────────
--  Two people moving the same card at the same moment must not both write seq
--  4. The unique index would catch it; assigning the number here means the
--  second one simply gets 5 rather than failing.
CREATE OR REPLACE FUNCTION assign_stage_history_seq() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.seq IS NULL OR NEW.seq = 0 THEN
    SELECT COALESCE(MAX(seq), 0) + 1 INTO NEW.seq
      FROM application_stage_history WHERE application_id = NEW.application_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER application_stage_history_seq
  BEFORE INSERT ON application_stage_history
  FOR EACH ROW EXECUTE FUNCTION assign_stage_history_seq();

-- ── Reference numbers ───────────────────────────────────────────────────────
--  REQ-2026-0001, APP-2026-000123, OFF-2026-0001, BYT-2026-0001. A sequence per
--  prefix per year, held in a table so the numbers survive a restore and cannot
--  be handed out twice.
CREATE TABLE IF NOT EXISTS reference_counters (
  prefix text NOT NULL,
  year   integer NOT NULL,
  next   integer NOT NULL DEFAULT 1,
  PRIMARY KEY (prefix, year)
);

CREATE OR REPLACE FUNCTION next_reference(p_prefix text, p_width integer DEFAULT 4, p_year integer DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE y integer; n integer;
BEGIN
  y := COALESCE(p_year, EXTRACT(YEAR FROM now())::integer);
  INSERT INTO reference_counters (prefix, year, next) VALUES (p_prefix, y, 2)
    ON CONFLICT (prefix, year) DO UPDATE SET next = reference_counters.next + 1
    RETURNING next - 1 INTO n;
  RETURN p_prefix || '-' || y::text || '-' || lpad(n::text, p_width, '0');
END $$;

-- ── The lead hiring manager ─────────────────────────────────────────────────
--  jobs.hiring_manager is the name the approval chain and the offer letter use.
--  It is denormalised from job_hiring_managers, so the database keeps the two
--  in step rather than trusting every writer to remember.
CREATE OR REPLACE FUNCTION sync_job_lead_hm() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_job text; v_name text;
BEGIN
  v_job := COALESCE(NEW.job_id, OLD.job_id);
  SELECT name INTO v_name FROM job_hiring_managers
    WHERE job_id = v_job AND is_lead ORDER BY sort_order LIMIT 1;
  IF v_name IS NULL THEN
    SELECT name INTO v_name FROM job_hiring_managers
      WHERE job_id = v_job ORDER BY sort_order LIMIT 1;
  END IF;
  UPDATE jobs SET hiring_manager = v_name WHERE id = v_job AND hiring_manager IS DISTINCT FROM v_name;
  RETURN NULL;
END $$;

CREATE TRIGGER job_hiring_managers_sync
  AFTER INSERT OR UPDATE OR DELETE ON job_hiring_managers
  FOR EACH ROW EXECUTE FUNCTION sync_job_lead_hm();

-- ── A seat cannot hold more people than it has approved ─────────────────────
--  The manpower plan is only worth reading if it cannot be over-filled.
CREATE OR REPLACE FUNCTION check_seat_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_approved integer; v_filled integer; v_state text;
BEGIN
  IF NEW.position_code IS NULL OR NEW.status = 'left' THEN RETURN NEW; END IF;
  SELECT approved, plan_state INTO v_approved, v_state
    FROM positions WHERE code = NEW.position_code;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_state = 'pending' THEN
    RAISE EXCEPTION 'seat % is requested, not approved headcount — nobody can be hired into it yet',
      NEW.position_code USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO v_filled FROM employees
    WHERE position_code = NEW.position_code AND status <> 'left' AND id <> NEW.id;
  IF v_filled + 1 > v_approved THEN
    RAISE EXCEPTION 'seat % has % approved place(s) and % would be the %th holder',
      NEW.position_code, v_approved, NEW.name, v_filled + 1
      USING ERRCODE = 'check_violation',
            HINT = 'Raise the approved headcount on the seat, or hire into another one.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER employees_seat_capacity
  BEFORE INSERT OR UPDATE OF position_code, status ON employees
  FOR EACH ROW EXECUTE FUNCTION check_seat_capacity();

-- ── An approval step is decided once ────────────────────────────────────────
--  Two approvers pressing Approve at the same instant must not both close the
--  same step and skip the next one.
CREATE OR REPLACE FUNCTION check_approval_step_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'pending' AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'this approval step was already %', OLD.state
      USING ERRCODE = 'restrict_violation',
            HINT = 'Reload the record — somebody decided it a moment ago.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER approval_steps_once
  BEFORE UPDATE ON approval_steps
  FOR EACH ROW EXECUTE FUNCTION check_approval_step_once();

-- ── A sent offer is immutable ───────────────────────────────────────────────
--  The letter the candidate holds cannot change. Re-negotiation makes a new
--  version; these columns are frozen the moment the envelope goes out.
CREATE OR REPLACE FUNCTION check_offer_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state IN ('sent','viewed','signed','accepted','declined','expired')
     AND (NEW.base_monthly, NEW.housing, NEW.transport, NEW.annual_bonus_pct,
          NEW.start_date, NEW.letter_override, NEW.template_id, NEW.field_overrides)
         IS DISTINCT FROM
         (OLD.base_monthly, OLD.housing, OLD.transport, OLD.annual_bonus_pct,
          OLD.start_date, OLD.letter_override, OLD.template_id, OLD.field_overrides) THEN
    RAISE EXCEPTION 'offer % has been sent — its terms and letter cannot change', OLD.reference
      USING ERRCODE = 'restrict_violation',
            HINT = 'Re-negotiate: that creates version ' || (OLD.version + 1)::text || '.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER offers_immutable_after_send
  BEFORE UPDATE ON offers
  FOR EACH ROW EXECUTE FUNCTION check_offer_immutable();

-- ── Optimistic locking ──────────────────────────────────────────────────────
--  The record carries a version; a write asserts the version it read. Two
--  people editing the same requisition means the second one is told, not that
--  their colleague's work disappears.
CREATE OR REPLACE FUNCTION bump_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version = OLD.version THEN NEW.version := OLD.version + 1; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER jobs_version BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER applications_version BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER candidates_version BEFORE UPDATE ON candidates
  FOR EACH ROW EXECUTE FUNCTION bump_version();

-- ── Candidate matching keys ─────────────────────────────────────────────────
--  Duplicate detection matches on normalised e-mail and phone, so the database
--  writes those keys rather than trusting every path in.
CREATE OR REPLACE FUNCTION normalise_candidate_keys() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.email_key := NULLIF(lower(btrim(COALESCE(NEW.email, ''))), '');
  NEW.phone_key := NULLIF(regexp_replace(COALESCE(NEW.phone, ''), '[^0-9]', '', 'g'), '');
  -- Saudi and Gulf mobiles come in as 05…, +9665…, 009665… — keep the last nine
  -- digits so the three forms of one number match each other.
  IF NEW.phone_key IS NOT NULL AND length(NEW.phone_key) > 9 THEN
    NEW.phone_key := right(NEW.phone_key, 9);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER candidates_keys
  BEFORE INSERT OR UPDATE OF email, phone ON candidates
  FOR EACH ROW EXECUTE FUNCTION normalise_candidate_keys();

-- ── Row counts the data page prints ─────────────────────────────────────────
CREATE OR REPLACE VIEW collection_sizes AS
SELECT relname AS collection, n_live_tup AS rows
  FROM pg_stat_user_tables WHERE schemaname = 'public';

-- ── Working-day arithmetic ──────────────────────────────────────────────────
--  KSA weekend is Friday and Saturday. SLA ageing counts calendar days the way
--  the product always has; this is here for the reports that ask for working
--  days, and to keep one definition of the weekend in the database too.
CREATE OR REPLACE FUNCTION is_ksa_weekend(d date) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT EXTRACT(DOW FROM d)::int IN (5, 6) $$;

-- generate_series over dates yields timestamps, so the cast back to date is
-- what keeps is_ksa_weekend resolvable.
CREATE OR REPLACE FUNCTION working_days_between(a timestamptz, b timestamptz) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT count(*)::int
    FROM generate_series(a::date, (b::date - 1), interval '1 day') AS g(d)
   WHERE NOT is_ksa_weekend(g.d::date)
$$;
