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
  'https://www.googleapis.com/auth/calendar.events',
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

/** Delete a GCal event by ID. Non-fatal — swallows errors. */
export async function deleteCalendarEvent(
  calendar: ReturnType<typeof google.calendar>,
  eventId: string,
): Promise<void> {
  try {
    await calendar.events.delete({ calendarId: 'primary', eventId });
    console.log('[deleteCalendarEvent] deleted', eventId);
  } catch (err) {
    console.warn('[deleteCalendarEvent] failed to delete', eventId, err);
  }
}
