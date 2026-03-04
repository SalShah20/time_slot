-- Migration 009: Add task splitting support
-- Adds session_number, total_sessions, parent_task_id to tasks table.
--
-- Data model:
--   Single-session task: parent_task_id=null, session_number=1, total_sessions=1
--   Split session 1 (canonical):  parent_task_id=null, session_number=1, total_sessions=N
--   Split sessions 2..N:          parent_task_id=<session1.id>, session_number=k, total_sessions=N

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS session_number  INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS total_sessions  INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_task_id  UUID    REFERENCES tasks(id) ON DELETE CASCADE;
