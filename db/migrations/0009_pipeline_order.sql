-- The pipeline templates are a curated list too.
--
-- Five templates, maintained by hand, read top to bottom on Settings →
-- Pipelines and offered in that order on the requisition form. Sorting them by
-- name puts "Commercial — Sales" — the one most requisitions are built from —
-- behind "Corporate — Standard" for no reason anybody could defend, and sorting
-- by id is worse. So the order is kept, the way the other reference lists keep
-- theirs.
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 1000;
CREATE INDEX IF NOT EXISTS pipelines_order_idx ON pipelines (sort_order, id);

UPDATE pipelines SET sort_order = CASE id
  WHEN 'pl_sales' THEN 0
  WHEN 'pl_eng'   THEN 1
  WHEN 'pl_corp'  THEN 2
  WHEN 'pl_grad'  THEN 3
  WHEN 'pl_vol'   THEN 4
  ELSE sort_order END;
