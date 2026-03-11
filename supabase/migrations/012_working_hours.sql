-- Add per-user working hours preferences to user_tokens
-- (user_tokens is the existing per-user settings table keyed by user_id)
ALTER TABLE user_tokens ADD COLUMN IF NOT EXISTS work_start_hour INTEGER NOT NULL DEFAULT 8;
ALTER TABLE user_tokens ADD COLUMN IF NOT EXISTS work_end_hour INTEGER NOT NULL DEFAULT 23;
ALTER TABLE user_tokens ADD COLUMN IF NOT EXISTS work_end_late_hour INTEGER NOT NULL DEFAULT 3;
