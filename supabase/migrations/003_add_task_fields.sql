-- Add description, tag, priority, and scheduled_end to tasks

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tag TEXT
  CHECK (tag IN ('Classes', 'Work', 'Personal', 'Other'));

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority TEXT
  CHECK (priority IN ('low', 'medium', 'high'));

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status);
