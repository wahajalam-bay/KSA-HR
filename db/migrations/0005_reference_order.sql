-- Two more lists whose order is editorial rather than alphabetical.
--
-- The application-question bank opens with the questions every requisition
-- asks — the right to work, the city, the notice period, the salary — and only
-- then the ones a particular family adds. Sorting that list by id or by text
-- buries the four that matter behind whatever happens to start with an A.
--
-- The offer letters are the same: the standard letter first, the commercial
-- variant under it, the bilingual one last. That is the order HR thinks of
-- them in, and the order the picker should offer them in.
ALTER TABLE question_bank     ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 1000;
ALTER TABLE offer_templates   ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 1000;
CREATE INDEX IF NOT EXISTS question_bank_order_idx   ON question_bank   (sort_order, id);
CREATE INDEX IF NOT EXISTS offer_templates_order_idx ON offer_templates (sort_order, id);
