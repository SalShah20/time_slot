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

  // Persist refreshed tokens so subsequent calls don't need to re-refresh
  oauth2Client.on('tokens', (tokens) => {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (tokens.access_token)  update.google_access_token  = tokens.access_token;
    if (tokens.refresh_token) update.google_refresh_token = tokens.refresh_token;
    if (tokens.expiry_date)   update.google_token_expiry  = new Date(tokens.expiry_date).toISOString();
    supabase.from('user_tokens').update(update).eq('user_id', userId).then(() => {
      console.log('[getCalendarClient] Persisted refreshed tokens for user', userId);
    });
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

/**
 * Fetches live busy intervals for a specific local day across ALL of the user's
 * Google Calendars using the freebusy API. Excludes the dedicated TimeSlot calendar.
 * Non-fatal — returns [] if any API call fails.
 */
export async function fetchCalendarEventsForDay(
  calendar: ReturnType<typeof google.calendar>,
  date: Date,
  timezone: string,
  excludeCalendarId?: string,
): Promise<Array<{ start: Date; end: Date }>> {
  try {
    const startOfDay = localTimeOnDay(date, 0, 0, timezone, 0);
    const endOfDay   = localTimeOnDay(date, 0, 0, timezone, 1);

    // Get all calendars, exclude the TimeSlot calendar
    const calListRes = await calendar.calendarList.list();
    const cals = (calListRes.data.items ?? []).filter(
      (c) => c.id && c.id !== excludeCalendarId,
    );
    if (cals.length === 0) return [];

    const freebusyRes = await calendar.freebusy.query({
      requestBody: {
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        items: cals.map((c) => ({ id: c.id! })),
      },
    });

    const results: Array<{ start: Date; end: Date }> = [];
    const calendars = freebusyRes.data.calendars ?? {};
    for (const calData of Object.values(calendars)) {
      for (const slot of calData.busy ?? []) {
        if (slot.start && slot.end) {
          results.push({ start: new Date(slot.start), end: new Date(slot.end) });
        }
      }
    }
    return results;
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

/**
 * Delete a GCal event by ID. Non-fatal — swallows errors.
 *
 * Strategy:
 *  1. Try the provided calendarId first (fastest path).
 *  2. If that fails, enumerate ALL writable calendars the user has and try each one.
 *     This handles the case where calendarId is stale / wrong (e.g. DB returned
 *     'primary' but the event was created inside the dedicated 'TimeSlot' calendar).
 */
export async function deleteCalendarEvent(
  calendar: ReturnType<typeof google.calendar>,
  eventId: string,
  calendarId = 'primary',
): Promise<void> {
  // Fast path: try the known calendar first
  try {
    await calendar.events.delete({ calendarId, eventId });
    console.log('[deleteCalendarEvent] deleted', eventId, 'from', calendarId);
    return;
  } catch { /* fall through to exhaustive search */ }

  // Slow path: enumerate all writable calendars and try each one
  try {
    const list = await calendar.calendarList.list({ minAccessRole: 'writer' });
    for (const cal of list.data.items ?? []) {
      if (!cal.id || cal.id === calendarId) continue; // already tried this one
      try {
        await calendar.events.delete({ calendarId: cal.id, eventId });
        console.log('[deleteCalendarEvent] deleted', eventId, 'from', cal.id, '(exhaustive search)');
        return;
      } catch { /* not in this calendar either */ }
    }
  } catch { /* can't list calendars */ }

  console.warn('[deleteCalendarEvent] event', eventId, 'not found in any calendar — may already be deleted');
}
