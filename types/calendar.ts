export interface CalendarEvent {
  id: string;
  user_id: string;
  google_event_id: string;
  title: string | null;
  start_time: string;
  end_time: string;
  is_busy: boolean;
  synced_at: string;
}
