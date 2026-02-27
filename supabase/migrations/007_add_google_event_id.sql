-- Store GCal event ID on tasks so we can update/delete events on reschedule or completion
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS google_event_id TEXT;
