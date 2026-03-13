import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createOAuthClient, getOrCreateTimeSlotCalendar, getTimeSlotCalendarId, getCalendarClient, deleteCalendarEvent } from '@/lib/googleCalendar';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { localTimeOnDay } from '@/lib/scheduleUtils';

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let timezone = 'UTC';
  try {
    const body = await req.json() as { timezone?: string };
    timezone = body.timezone ?? 'UTC';
  } catch { /* no body or non-JSON */ }

  const supabase = createSupabaseServer();

  // Load stored tokens
  const { data: tokenRow, error: tokenError } = await supabase
    .from('user_tokens')
    .select('google_access_token, google_refresh_token, google_token_expiry, webhook_channel_id, webhook_expires_at')
    .eq('user_id', user.id)
    .single();

  if (tokenError || !tokenRow?.google_access_token) {
    return NextResponse.json({ error: 'Not connected to Google Calendar' }, { status: 401 });
  }

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.google_access_token,
    refresh_token: tokenRow.google_refresh_token ?? undefined,
    expiry_date: tokenRow.google_token_expiry
      ? new Date(tokenRow.google_token_expiry).getTime()
      : undefined,
  });

  // Persist refreshed tokens if they changed
  oauth2Client.on('tokens', async (tokens) => {
    await supabase.from('user_tokens').upsert({
      user_id: user.id,
      google_access_token: tokens.access_token ?? tokenRow.google_access_token,
      google_refresh_token: tokens.refresh_token ?? tokenRow.google_refresh_token,
      google_token_expiry: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : tokenRow.google_token_expiry,
    });
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // Ensure the dedicated TimeSlot calendar exists (creates it on first sync, non-fatal)
  try {
    await getOrCreateTimeSlotCalendar(supabase, user.id, calendar);
  } catch (err) {
    console.warn('[/api/calendar/sync] TimeSlot calendar setup failed (non-fatal):', err);
  }

  // Get the TimeSlot calendar ID so we can exclude it from freebusy
  const timeSlotCalId = await getTimeSlotCalendarId(supabase, user.id);

  // Fetch events for today + tomorrow (use user's local timezone for date boundaries)
  const now = new Date();
  const startOfDay   = localTimeOnDay(now, 0, 0, timezone, 0).toISOString();
  const endOfTomorrow = localTimeOnDay(now, 0, 0, timezone, 2).toISOString();

  console.log('[/api/calendar/sync] Querying Google Calendar freebusy:', { startOfDay, endOfTomorrow, serverDate: now.toISOString() });

  // Single Google account only. Multi-account is not supported.
  // Freebusy query across all calendars in the connected account.
  const rows: Array<{
    user_id: string;
    google_event_id: string;
    title: string | null;
    start_time: string;
    end_time: string;
    is_busy: boolean;
    synced_at: string;
  }> = [];

  try {
    // 1. Fetch the user's full calendar list + filter preferences in parallel
    const [calListRes, filtersRes] = await Promise.all([
      calendar.calendarList.list(),
      supabase
        .from('calendar_filters')
        .select('google_calendar_id, is_included')
        .eq('user_id', user.id),
    ]);
    const allCals = calListRes.data.items ?? [];

    // Build a lookup of explicit filter preferences
    const filterMap = new Map<string, boolean>();
    for (const row of (filtersRes.data ?? []) as Array<{ google_calendar_id: string; is_included: boolean }>) {
      filterMap.set(row.google_calendar_id, row.is_included);
    }

    // Include calendars using opt-out model:
    //  - Has filter row → respect is_included
    //  - No filter row  → included by default
    //  - TimeSlot calendar → always excluded
    const freebusyCals = allCals.filter((c) => {
      if (!c.id || c.id === timeSlotCalId) return false;
      if (filterMap.has(c.id)) return filterMap.get(c.id)!;
      return true; // no filter row → included by default
    });

    console.log(
      '[/api/calendar/sync] Calendars found:',
      allCals.length,
      '| Querying freebusy for:',
      freebusyCals.length,
      freebusyCals.map((c) => c.summary ?? c.id),
    );

    if (freebusyCals.length > 0) {
      // 2. Fetch actual events (with titles) from each included calendar
      await Promise.all(freebusyCals.map(async (cal) => {
        try {
          const eventsRes = await calendar.events.list({
            calendarId: cal.id!,
            timeMin: startOfDay,
            timeMax: endOfTomorrow,
            singleEvents: true,   // expand recurring events
            orderBy: 'startTime',
            maxResults: 250,
          });
          for (const event of eventsRes.data.items ?? []) {
            if (event.status === 'cancelled') continue;
            // transparent = "free" — skip, we only want busy time
            if (event.transparency === 'transparent') continue;
            // All-day events only have start.date, not dateTime — skip for hourly view
            const eventStart = event.start?.dateTime;
            const eventEnd   = event.end?.dateTime;
            if (!eventStart || !eventEnd || !event.id) continue;
            rows.push({
              user_id: user.id,
              google_event_id: event.id,
              title: event.summary ?? cal.summary ?? null,
              start_time: eventStart,
              end_time: eventEnd,
              is_busy: true,
              synced_at: new Date().toISOString(),
            });
          }
        } catch (err) {
          console.warn(`[/api/calendar/sync] events.list failed for ${cal.id}:`, err);
        }
      }));
    }
  } catch (err: unknown) {
    const gErr = err as {
      code?: number | string;
      status?: number;
      response?: { status?: number };
      message?: string;
    };
    const httpStatus = gErr.status ?? gErr.response?.status ?? (typeof gErr.code === 'number' ? gErr.code : undefined);
    const isAuthError =
      httpStatus === 400 || httpStatus === 401 || httpStatus === 403 ||
      (typeof gErr.message === 'string' && (
        gErr.message.includes('invalid_grant') ||
        gErr.message.includes('No refresh token') ||
        gErr.message.includes('Token has been expired') ||
        gErr.message.includes('invalid_token')
      ));

    console.error('[/api/calendar/sync] Google API error:', {
      code: gErr?.code,
      httpStatus,
      message: gErr?.message,
      isAuthError,
    });

    if (isAuthError) {
      return NextResponse.json({ error: 'auth', message: gErr?.message }, { status: 401 });
    }
    return NextResponse.json({ error: 'google_api', message: gErr?.message }, { status: 500 });
  }

  console.log('[/api/calendar/sync] Freebusy rows to upsert:', rows.length);

  // Insert-then-delete-stale strategy: never leave the DB empty during sync.
  const freshIds = rows.map((r) => r.google_event_id);

  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from('calendar_events')
      .upsert(rows, { onConflict: 'user_id,google_event_id' });
    if (upsertError) {
      console.error('[/api/calendar/sync] upsert error:', upsertError);
      return NextResponse.json({ error: 'Failed to cache events' }, { status: 500 });
    }
    console.log('[/api/calendar/sync] Upsert succeeded');
  }

  // Delete stale entries in the date range that Google no longer returned.
  // Guard: only run when Google returned ≥1 event.
  if (freshIds.length > 0) {
    const { data: existing } = await supabase
      .from('calendar_events')
      .select('id, google_event_id')
      .eq('user_id', user.id)
      .gte('start_time', startOfDay)
      .lt('start_time', endOfTomorrow);

    const freshIdSet = new Set(freshIds);
    const staleRowIds = (existing ?? [])
      .filter((e) => !freshIdSet.has(e.google_event_id))
      .map((e) => e.id as string);

    if (staleRowIds.length > 0) {
      const { error: staleErr } = await supabase
        .from('calendar_events')
        .delete()
        .in('id', staleRowIds);
      if (staleErr) console.warn('[/api/calendar/sync] stale-delete error:', staleErr);
      else console.log('[/api/calendar/sync] Removed', staleRowIds.length, 'stale events');
    }
  }

  // ── Orphaned GCal event cleanup ─────────────────────────────────────────────
  // Completed tasks that still have a google_event_id indicate a prior deletion
  // attempt failed. Try again now that we have a working calendar client.
  try {
    const { data: orphaned } = await supabase
      .from('tasks')
      .select('id, google_event_id')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .not('google_event_id', 'is', null);

    if (orphaned && orphaned.length > 0) {
      const calClient = await getCalendarClient(supabase, user.id);
      if (calClient) {
        const calId = await getTimeSlotCalendarId(supabase, user.id);
        await Promise.all(
          orphaned.map(async (t) => {
            await deleteCalendarEvent(calClient, t.google_event_id as string, calId);
            await supabase.from('tasks').update({ google_event_id: null }).eq('id', t.id);
          }),
        );
        console.log('[/api/calendar/sync] Cleaned up', orphaned.length, 'orphaned GCal events');
      }
    }
  } catch (err) {
    console.warn('[/api/calendar/sync] Orphaned event cleanup failed (non-fatal):', err);
  }

  // Renew the webhook channel if it expires within 48h
  const renewThreshold = new Date(Date.now() + 48 * 60 * 60 * 1000);
  if (!tokenRow.webhook_expires_at || new Date(tokenRow.webhook_expires_at) < renewThreshold) {
    try {
      const newChannelId = crypto.randomUUID();
      const expiresMs = Date.now() + 6 * 24 * 60 * 60 * 1000;
      const watchRes = await calendar.events.watch({
        calendarId: 'primary',
        requestBody: {
          id:         newChannelId,
          type:       'web_hook',
          address:    `${process.env.NEXT_PUBLIC_APP_URL}/api/calendar/webhook`,
          token:      user.id,
          expiration: String(expiresMs),
        },
      });
      await supabase.from('user_tokens').update({
        webhook_channel_id:  newChannelId,
        webhook_resource_id: watchRes.data.resourceId ?? null,
        webhook_expires_at:  new Date(Number(watchRes.data.expiration ?? expiresMs)).toISOString(),
      }).eq('user_id', user.id);
      console.log('[/api/calendar/sync] Webhook channel renewed until', new Date(expiresMs).toISOString());
    } catch (err) {
      console.warn('[/api/calendar/sync] Channel renewal failed:', err);
    }
  }

  return NextResponse.json({ synced: rows.length });
}
