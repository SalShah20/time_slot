-- Migration 013: Change work hour columns from INTEGER to REAL for 30-min granularity,
-- and add work_timezone to store the user's timezone.

ALTER TABLE user_tokens ALTER COLUMN work_start_hour TYPE REAL USING work_start_hour::REAL;
ALTER TABLE user_tokens ALTER COLUMN work_end_hour TYPE REAL USING work_end_hour::REAL;
ALTER TABLE user_tokens ALTER COLUMN work_end_late_hour TYPE REAL USING work_end_late_hour::REAL;

ALTER TABLE user_tokens ADD COLUMN IF NOT EXISTS work_timezone TEXT;
