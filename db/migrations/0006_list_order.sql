-- The last of the reference lists that are shown in a curated order.
--
-- Every one of these is a short list a person maintains by hand and reads top
-- to bottom: the pitch projects a recruiter picks from, the e-mail templates,
-- the interview kits, the automation rules, the integrations and the approval
-- flows. None of them has a natural sort — not the name, not the id, not the
-- date — and an alphabetical list puts whatever happens to start with an A in
-- front of the one everybody uses.
--
-- So each carries the order it is meant to be read in. New rows default to
-- 1000 and fall to the end, where a person can move them.
ALTER TABLE pitch_projects   ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 1000;
ALTER TABLE email_templates  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 1000;
ALTER TABLE interview_kits   ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 1000;
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 1000;
ALTER TABLE integrations     ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 1000;
ALTER TABLE approval_flows   ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 1000;

CREATE INDEX IF NOT EXISTS pitch_projects_order_idx   ON pitch_projects   (sort_order, id);
CREATE INDEX IF NOT EXISTS email_templates_order_idx  ON email_templates  (sort_order, id);
CREATE INDEX IF NOT EXISTS interview_kits_order_idx   ON interview_kits   (sort_order, id);
CREATE INDEX IF NOT EXISTS automation_rules_order_idx ON automation_rules (sort_order, id);
CREATE INDEX IF NOT EXISTS integrations_order_idx     ON integrations     (sort_order, id);
CREATE INDEX IF NOT EXISTS approval_flows_order_idx   ON approval_flows   (sort_order, id);
