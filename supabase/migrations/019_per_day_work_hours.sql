-- 019: Per-day work hours overrides
-- Allows users to set different work hours for different days of the week
-- (e.g., "weekdays start at 8am, weekends start at 11am").
-- Format: JSONB object with keys "0"-"6" (0=Sunday, 6=Saturday), each containing
-- optional overrides: { "workStartHour": number, "workEndHour": number, "workEndLateHour": number }

ALTER TABLE user_tokens
  ADD COLUMN IF NOT EXISTS work_hours_by_day JSONB DEFAULT NULL;
