-- Two curated lists were left in alphabetical order when sort_order was added.
--
-- `sort_order` exists because neither list has a natural sort, and the backfill
-- that gave the existing rows a number ordered them by id — which is the very
-- thing the column was introduced to stop. Both are short, fixed lists, so the
-- order is set here by what each row is, and it is the same order a fresh seed
-- writes (db/seed/run.ts) rather than a second opinion about it.

-- The approvals page opens on the requisition chain, because a requisition is
-- approved before there is an offer to approve.
UPDATE approval_flows SET sort_order = CASE subject
  WHEN 'requisition' THEN 0
  WHEN 'offer'       THEN 1
  ELSE sort_order END;

-- The integrations page, in the seeder's order.
UPDATE integrations SET sort_order = CASE key
  WHEN 'calendar'   THEN 0
  WHEN 'email'      THEN 1
  WHEN 'whatsapp'   THEN 2
  WHEN 'sms'        THEN 3
  WHEN 'esign'      THEN 4
  WHEN 'voice'      THEN 5
  WHEN 'hris'       THEN 6
  WHEN 'assessment' THEN 7
  WHEN 'linkedin'   THEN 8
  WHEN 'ai'         THEN 9
  WHEN 'storage'    THEN 10
  WHEN 'malware'    THEN 11
  ELSE sort_order END;
