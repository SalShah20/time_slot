-- Fix tag column CHECK constraint to match application tag values.
-- Run this if you already ran 003_add_task_fields.sql (which used wrong values).
-- Safe to run multiple times.

-- Step 1: Ensure scheduled_end, description, priority columns exist (idempotent catch-up)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_end  TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description    TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority       TEXT;

-- Step 2: Drop any CHECK constraint on the tag column that has wrong values
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT conname
    FROM   pg_constraint
    WHERE  conrelid = 'tasks'::regclass
      AND  contype  = 'c'
      AND  pg_get_constraintdef(oid) ILIKE '%tag%'
  ) LOOP
    EXECUTE 'ALTER TABLE tasks DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END;
$$;

-- Step 3: Add correct tag constraint
ALTER TABLE tasks
  ADD CONSTRAINT tasks_tag_check
  CHECK (tag IN ('Study', 'Work', 'Personal', 'Exercise', 'Other'));

-- Step 4: Add priority constraint if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE  conrelid = 'tasks'::regclass
      AND  contype  = 'c'
      AND  pg_get_constraintdef(oid) ILIKE '%priority%'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_priority_check
      CHECK (priority IN ('low', 'medium', 'high'));
  END IF;
END;
$$;

-- Step 5: Index
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status);
