-- Links a candidate opens without signing in.
--
-- Six flows send one: the screening chat, the "pick a time" booking link, the
-- offer the candidate reads, the e-signature page, the behaviour assessment and
-- the reference form. All six are the same object — a single-purpose, expiring,
-- revocable key to one record — so they are one table rather than six columns
-- scattered across the schema.
--
-- The token itself is never stored. What is stored is its SHA-256, exactly as a
-- password is, because a link in an e-mail is a credential: anybody holding the
-- database should not be able to open a candidate's offer.
CREATE TABLE IF NOT EXISTS access_links (
  id             text PRIMARY KEY,
  token_hash     text NOT NULL,
  purpose        text NOT NULL,
  subject_type   text NOT NULL,
  subject_id     text NOT NULL,
  candidate_id   text REFERENCES candidates(id) ON DELETE CASCADE,
  application_id text REFERENCES applications(id) ON DELETE CASCADE,
  expires_at     timestamptz,
  max_uses       integer,
  uses           integer NOT NULL DEFAULT 0,
  first_used_at  timestamptz,
  last_used_at   timestamptz,
  last_used_ip   text,
  revoked_at     timestamptz,
  revoked_by     text,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS access_links_token_uq ON access_links (token_hash);
CREATE INDEX IF NOT EXISTS access_links_subject_idx ON access_links (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS access_links_live_idx ON access_links (purpose, expires_at)
  WHERE revoked_at IS NULL;

-- A link that has been used more often than it was allowed to be, or that
-- expired before it was created, is a bug rather than a state.
ALTER TABLE access_links DROP CONSTRAINT IF EXISTS access_links_uses_ck;
ALTER TABLE access_links ADD CONSTRAINT access_links_uses_ck
  CHECK (max_uses IS NULL OR uses <= max_uses);
