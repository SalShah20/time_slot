-- 020: Task difficulty rating
-- Stores user-reported difficulty after completing a task.
-- Used to adjust future duration estimates for similar tasks.
-- Values: 'harder', 'right', 'easy'

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS difficulty_rating TEXT DEFAULT NULL;
