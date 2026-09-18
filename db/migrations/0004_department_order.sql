-- Departments are listed in the order the organisation itself keeps them:
-- Management, then the sales line, then the support functions. Alphabetical
-- order is not that order, and every report that ranks departments falls back
-- on the list order whenever two of them tie, so the tie-break has to be the
-- org's own sequence rather than an accident of the collation.
ALTER TABLE departments ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 1000;
CREATE INDEX IF NOT EXISTS departments_order_idx ON departments (sort_order, name);
