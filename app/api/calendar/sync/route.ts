import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createOAuthClient } from '@/lib/googleCalendar';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';

export async function POST() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

  // Fetch events for today + tomorrow so the tomorrow view is populated
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).toISOString();

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

  // Delete cached events for today+tomorrow first so removed events don't linger
  const { error: deleteError } = await supabase
    .from('calendar_events')
    .delete()
    .eq('user_id', user.id)
    .gte('start_time', startOfDay)
    .lt('start_time', endOfDay);

  if (deleteError) {
    console.error('[/api/calendar/sync] delete error:', deleteError);
    return NextResponse.json({ error: 'Failed to clear stale events' }, { status: 500 });
  }

  if (rows.length > 0) {
    const { error: insertError } = await supabase
      .from('calendar_events')
      .insert(rows);

    if (insertError) {
      console.error('[/api/calendar/sync] insert error:', insertError);
      return NextResponse.json({ error: 'Failed to cache events' }, { status: 500 });
    }
    console.log('[/api/calendar/sync] Insert succeeded');
  }

  return NextResponse.json({ synced: rows.length });
}
