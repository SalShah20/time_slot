-- 018: Google Classroom integration
-- Adds Classroom sync tracking to user_tokens and a dedup table for imported assignments.

ALTER TABLE user_tokens
  ADD COLUMN IF NOT EXISTS classroom_connected BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS classroom_last_synced TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS classroom_imported_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  classroom_assignment_id TEXT NOT NULL,
  classroom_course_id TEXT NOT NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, classroom_assignment_id)
);

ALTER TABLE classroom_imported_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own classroom imports"
  ON classroom_imported_assignments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own classroom imports"
  ON classroom_imported_assignments FOR INSERT
  WITH CHECK (auth.uid() = user_id);
