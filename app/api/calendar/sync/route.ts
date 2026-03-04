import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createOAuthClient } from '@/lib/googleCalendar';
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
    .select('google_access_token, google_refresh_token, google_token_expiry')
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

  // Fetch events for today + tomorrow (use user's local timezone for date boundaries)
  const now = new Date();
  const startOfDay = localTimeOnDay(now, 0, 0, timezone, 0).toISOString();
  const endOfDay   = localTimeOnDay(now, 0, 0, timezone, 2).toISOString();

  console.log('[/api/calendar/sync] Querying Google Calendar:', { startOfDay, endOfDay, serverDate: now.toISOString() });

  let response;
  try {
    response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfDay,
      timeMax: endOfDay,
      singleEvents: true,
      orderBy: 'startTime',
    });
  } catch (err: unknown) {
    // googleapis v100+ (gaxios-based) puts the HTTP status in err.status or
    // err.response?.status, NOT in err.code (which is a string like "ERR_BAD_REQUEST").
    // Older code that checked err.code === 401 always missed auth failures.
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

  const events = response.data.items ?? [];
  console.log('[/api/calendar/sync] Google returned', events.length, 'events:', events.map(e => ({
    id: e.id,
    summary: e.summary,
    start: e.start?.dateTime ?? e.start?.date,
  })));

  const rows = events
    .filter((e) => e.id && (e.start?.dateTime || e.start?.date))
    .map((e) => ({
      user_id: user.id,
      google_event_id: e.id!,
      title: e.summary ?? null,
      // For all-day events (no dateTime), use local midnight so date-range
      // queries (which are also based on local midnight) include them correctly.
      start_time: e.start!.dateTime ?? (() => {
        const [y, m, d] = e.start!.date!.split('-').map(Number);
        return new Date(y, m - 1, d).toISOString();
      })(),
      end_time: e.end!.dateTime ?? (() => {
        const [y, m, d] = e.end!.date!.split('-').map(Number);
        return new Date(y, m - 1, d).toISOString();
      })(),
      is_busy: e.transparency !== 'transparent',
      synced_at: new Date().toISOString(),
    }));

  console.log('[/api/calendar/sync] Rows to upsert:', rows.length);

  // Insert-then-delete-stale strategy: never leave the DB empty during sync.
  // 1. Remove existing cache entries ONLY for the events we're about to refresh (by ID).
  // 2. Insert fresh events.
  // 3. Delete any remaining entries in the date range that Google no longer returned.
  const freshIds = rows.map((r) => r.google_event_id);

  if (rows.length > 0) {
    // Step 1: clear existing entries for these specific event IDs (prevent duplicates)
    const { error: delExistingError } = await supabase
      .from('calendar_events')
      .delete()
      .eq('user_id', user.id)
      .in('google_event_id', freshIds);
    if (delExistingError) console.warn('[/api/calendar/sync] clear-existing error:', delExistingError);

    // Step 2: insert fresh data
    const { error: insertError } = await supabase
      .from('calendar_events')
      .insert(rows);
    if (insertError) {
      console.error('[/api/calendar/sync] insert error:', insertError);
      return NextResponse.json({ error: 'Failed to cache events' }, { status: 500 });
    }
    console.log('[/api/calendar/sync] Insert succeeded');
  }

  // Step 3: delete stale entries in the date range that Google no longer returned.
  // Guard: only run when Google returned ≥1 event — if Google returns 0 we keep
  // existing entries to avoid wiping everything on transient API issues or empty days.
  if (freshIds.length > 0) {
    // Fetch all IDs currently in the date range so we can filter in JS (avoids PostgREST NOT-IN syntax issues)
    const { data: existing } = await supabase
      .from('calendar_events')
      .select('id, google_event_id')
      .eq('user_id', user.id)
      .gte('start_time', startOfDay)
      .lt('start_time', endOfDay);

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

  return NextResponse.json({ synced: rows.length });
}
