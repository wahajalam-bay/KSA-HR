-- What somebody did with the file, not only that they touched it.
--
-- A CV is somebody's personal data, and "who has read this" is a question a
-- candidate is entitled to ask. The log recorded who and when but not what:
-- opening a preview, downloading the file and minting a link somebody else can
-- use are three different acts, and the middle one is the one that leaves the
-- building.
ALTER TABLE file_access_log ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'download';
CREATE INDEX IF NOT EXISTS file_access_log_action_idx ON file_access_log (action, at);
