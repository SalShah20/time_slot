-- 016: Canvas LMS integration + premium flag
-- Adds Canvas credentials to user_tokens, premium gate, source tracking on tasks,
-- and a dedup table for imported assignments.

-- Premium gate
ALTER TABLE user_tokens
  ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT false;

-- Canvas credentials (stored alongside other user tokens)
ALTER TABLE user_tokens
  ADD COLUMN IF NOT EXISTS canvas_token TEXT,
  ADD COLUMN IF NOT EXISTS canvas_domain TEXT,
  ADD COLUMN IF NOT EXISTS canvas_last_synced TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS canvas_auto_sync BOOLEAN NOT NULL DEFAULT false;

-- Track task origin
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

-- Dedup table: which Canvas assignments have already been imported
CREATE TABLE IF NOT EXISTS canvas_imported_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  canvas_assignment_id TEXT NOT NULL,
  canvas_course_id TEXT NOT NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  imported_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, canvas_assignment_id)
);

-- RLS
ALTER TABLE canvas_imported_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own canvas imports"
  ON canvas_imported_assignments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own canvas imports"
  ON canvas_imported_assignments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own canvas imports"
  ON canvas_imported_assignments FOR DELETE
  USING (auth.uid() = user_id);
