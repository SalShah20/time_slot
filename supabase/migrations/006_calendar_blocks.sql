-- Manual calendar blocks (user-created time blocks, not from Google)

CREATE TABLE IF NOT EXISTS calendar_blocks (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL,
  title      TEXT        NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time   TIMESTAMPTZ NOT NULL,
  is_busy    BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calendar_blocks_user_time_idx ON calendar_blocks (user_id, start_time);

ALTER TABLE calendar_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_blocks_owner ON calendar_blocks
  USING (user_id = auth.uid());
