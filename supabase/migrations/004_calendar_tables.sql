-- Google Calendar integration tables

-- Stores OAuth tokens per user
CREATE TABLE IF NOT EXISTS user_tokens (
  user_id             UUID        PRIMARY KEY,
  google_access_token TEXT,
  google_refresh_token TEXT,
  google_token_expiry  TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cache of Google Calendar events (read-only, refreshed on sync)
CREATE TABLE IF NOT EXISTS calendar_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL,
  google_event_id TEXT        NOT NULL,
  title           TEXT,
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  is_busy         BOOLEAN     NOT NULL DEFAULT true,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, google_event_id)
);

CREATE INDEX IF NOT EXISTS calendar_events_user_start_idx ON calendar_events (user_id, start_time);
