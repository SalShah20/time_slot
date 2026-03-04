import { google } from 'googleapis';
import type { SupabaseClient } from '@supabase/supabase-js';
import { localTimeOnDay } from '@/lib/scheduleUtils';

export function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    `${process.env.NEXT_PUBLIC_APP_URL}/api/calendar/callback`
  );
}

export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
];

/** Returns an authenticated Google Calendar client, or null if no tokens stored. */
export async function getCalendarClient(supabase: SupabaseClient, userId: string) {
  const { data: tokenRow } = await supabase
    .from('user_tokens')
    .select('google_access_token, google_refresh_token, google_token_expiry')
    .eq('user_id', userId)
    .single();

  if (!tokenRow?.google_access_token) return null;

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    access_token:  tokenRow.google_access_token,
    refresh_token: tokenRow.google_refresh_token ?? undefined,
    expiry_date:   tokenRow.google_token_expiry
      ? new Date(tokenRow.google_token_expiry).getTime()
      : undefined,
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

/**
 * Fetches live Google Calendar events for a specific local day and returns them
 * as busy intervals. Non-fatal — returns [] if the API call fails.
 */
export async function fetchCalendarEventsForDay(
  calendar: ReturnType<typeof google.calendar>,
  date: Date,
  timezone: string,
): Promise<Array<{ start: Date; end: Date }>> {
  try {
    const startOfDay = localTimeOnDay(date, 0, 0, timezone, 0);
    const endOfDay   = localTimeOnDay(date, 0, 0, timezone, 1);

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (res.data.items ?? [])
      .filter((e) => e.start?.dateTime && e.end?.dateTime && e.status !== 'cancelled')
      .map((e) => ({
        start: new Date(e.start!.dateTime!),
        end:   new Date(e.end!.dateTime!),
      }));
  } catch (err) {
    console.warn('[fetchCalendarEventsForDay] API call failed:', err);
    return [];
  }
}

/** Priority label → Google Calendar colorId. */
export function getPriorityColorId(priority?: string | null): string {
  switch (priority?.toLowerCase()) {
    case 'high':   return '11'; // Tomato
    case 'low':    return '8';  // Graphite
    case 'medium':
    default:       return '10'; // Sage
  }
}

/**
 * Returns the stored TimeSlot calendar ID for a user, or 'primary' if not set.
 * Fast read-only DB query — no API call.
 */
export async function getTimeSlotCalendarId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from('user_tokens')
    .select('google_calendar_id')
    .eq('user_id', userId)
    .single();
  return (data as { google_calendar_id?: string | null } | null)?.google_calendar_id ?? 'primary';
}

/**
 * Ensures the "TimeSlot" calendar exists for this user.
 * Creates it if missing, stores the ID in user_tokens, tries to set the brand color.
 * Falls back to 'primary' on any error (e.g. insufficient OAuth scope).
 */
export async function getOrCreateTimeSlotCalendar(
  supabase: SupabaseClient,
  userId: string,
  calendar: ReturnType<typeof google.calendar>,
): Promise<string> {
  const stored = await getTimeSlotCalendarId(supabase, userId);
  if (stored !== 'primary') return stored;

  try {
    const newCal = await calendar.calendars.insert({
      requestBody: { summary: 'TimeSlot' },
    });
    const calId = newCal.data.id;
    if (!calId) return 'primary';

    await supabase
      .from('user_tokens')
      .update({ google_calendar_id: calId })
      .eq('user_id', userId);

    // Try to set brand color via calendarList — non-fatal
    try {
      await calendar.calendarList.patch({
        calendarId: calId,
        requestBody: { backgroundColor: '#028090', foregroundColor: '#ffffff' },
      });
    } catch { /* non-fatal */ }

    console.log('[getOrCreateTimeSlotCalendar] Created TimeSlot calendar:', calId);
    return calId;
  } catch (err) {
    console.warn('[getOrCreateTimeSlotCalendar] Could not create calendar — falling back to primary:', err);
    return 'primary';
  }
}

/** Delete a GCal event by ID. Non-fatal — swallows errors. */
export async function deleteCalendarEvent(
  calendar: ReturnType<typeof google.calendar>,
  eventId: string,
  calendarId = 'primary',
): Promise<void> {
  try {
    await calendar.events.delete({ calendarId, eventId });
    console.log('[deleteCalendarEvent] deleted', eventId, 'from', calendarId);
  } catch (err) {
    console.warn('[deleteCalendarEvent] failed to delete', eventId, err);
  }
}
