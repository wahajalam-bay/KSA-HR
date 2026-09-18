-- The task kinds the desk actually raises, taken from the prototype's own
-- to-do list rather than guessed: chasing a scorecard, reviewing a pile of CVs,
-- booking a screen call, sending a regret, drafting an offer, sourcing.
ALTER TYPE task_kind ADD VALUE IF NOT EXISTS 'review_cv';
ALTER TYPE task_kind ADD VALUE IF NOT EXISTS 'schedule';
ALTER TYPE task_kind ADD VALUE IF NOT EXISTS 'screen_call';
ALTER TYPE task_kind ADD VALUE IF NOT EXISTS 'send_offer';
ALTER TYPE task_kind ADD VALUE IF NOT EXISTS 'sourcing';
ALTER TYPE task_kind ADD VALUE IF NOT EXISTS 'reject';
ALTER TYPE task_kind ADD VALUE IF NOT EXISTS 'interview';
ALTER TYPE task_kind ADD VALUE IF NOT EXISTS 'document';
