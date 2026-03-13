-- Add per-task custom reminder setting
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER DEFAULT NULL;

-- NULL = use default (15 min), 0 = no reminder, positive integer = custom minutes before start
COMMENT ON COLUMN tasks.reminder_minutes IS 'Custom reminder: NULL=default 15min, 0=none, N=N minutes before start';
