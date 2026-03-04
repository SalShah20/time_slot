-- Migration 010: Add google_calendar_id to user_tokens
-- Stores the ID of the user's dedicated "TimeSlot" Google Calendar.
-- NULL means the calendar hasn't been created yet; events fall back to 'primary'.

ALTER TABLE user_tokens
  ADD COLUMN IF NOT EXISTS google_calendar_id TEXT;
