-- 017: Natural language scheduling preferences
-- Adds the raw paragraph + parsed summary and boolean preference flags to user_tokens.
-- Working hours (work_start_hour, work_end_hour, work_end_late_hour) already exist as REAL columns.

ALTER TABLE user_tokens
  ADD COLUMN IF NOT EXISTS scheduling_context TEXT,        -- raw paragraph the user typed
  ADD COLUMN IF NOT EXISTS scheduling_notes TEXT,          -- GPT-extracted plain-English summary
  ADD COLUMN IF NOT EXISTS prefer_mornings BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prefer_evenings BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS avoid_back_to_back BOOLEAN NOT NULL DEFAULT false;
