-- TimeSlot initial schema
-- Run against your Supabase project via the SQL editor or supabase db push

-- ─── tasks ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL,
  title             TEXT        NOT NULL,
  estimated_minutes INTEGER     NOT NULL CHECK (estimated_minutes > 0),
  actual_duration   INTEGER,                  -- seconds, filled on completion
  deadline          TIMESTAMPTZ,
  status            TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks (user_id);

-- ─── active_timers ────────────────────────────────────────────────────────────
-- One row per user — enforced by UNIQUE constraint.
-- This is the source of truth for restoring timer state on page load.
CREATE TABLE IF NOT EXISTS active_timers (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL UNIQUE,
  task_id                 UUID        NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  state                   TEXT        NOT NULL DEFAULT 'WORKING'
                          CHECK (state IN ('WORKING', 'PAUSED', 'ON_BREAK')),
  started_at              TIMESTAMPTZ NOT NULL,
  paused_at               TIMESTAMPTZ,
  current_break_started_at TIMESTAMPTZ,
  total_break_seconds     INTEGER     NOT NULL DEFAULT 0,
  estimated_minutes       INTEGER     NOT NULL,
  task_title              TEXT        NOT NULL,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS active_timers_user_id_idx ON active_timers (user_id);

-- ─── timer_sessions ───────────────────────────────────────────────────────────
-- Each row is one continuous work or break segment.
-- ended_at IS NULL while the segment is in progress.
CREATE TABLE IF NOT EXISTS timer_sessions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID        NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL,
  type       TEXT        NOT NULL CHECK (type IN ('work', 'break')),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at   TIMESTAMPTZ,
  duration   INTEGER,                -- seconds, computed on end
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS timer_sessions_task_id_idx ON timer_sessions (task_id);
CREATE INDEX IF NOT EXISTS timer_sessions_user_id_idx ON timer_sessions (user_id);

-- ─── updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER active_timers_updated_at
  BEFORE UPDATE ON active_timers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
