-- Talent pools are shown as a grid of cards, and a grid needs a stable order.
-- Alphabetical would reshuffle the moment somebody renames one, and "newest
-- first" buries the pool everybody uses. So the order is the order they were
-- built in, held explicitly rather than inferred from a timestamp that says
-- when the segment was defined rather than when the card was added.
ALTER TABLE talent_pools ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 1000;
CREATE INDEX IF NOT EXISTS talent_pools_order_idx ON talent_pools (sort_order, name);
