-- Webhook channel tracking columns on user_tokens
ALTER TABLE user_tokens
  ADD COLUMN IF NOT EXISTS webhook_channel_id   TEXT,
  ADD COLUMN IF NOT EXISTS webhook_resource_id  TEXT,
  ADD COLUMN IF NOT EXISTS webhook_expires_at   TIMESTAMPTZ;

-- Flag for tasks that could not be rescheduled before their deadline
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS needs_rescheduling BOOLEAN DEFAULT FALSE;
