-- Fixed-time tasks: pinned to a specific time, never auto-rescheduled
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS is_fixed BOOLEAN NOT NULL DEFAULT false;
