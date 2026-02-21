ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS tasks_scheduled_start_idx ON tasks (scheduled_start);
