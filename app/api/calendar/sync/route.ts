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

  // Fetch events for today
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: startOfDay,
    timeMax: endOfDay,
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = response.data.items ?? [];

  const rows = events
    .filter((e) => e.id && (e.start?.dateTime || e.start?.date))
    .map((e) => ({
      user_id: user.id,
      google_event_id: e.id!,
      title: e.summary ?? null,
      start_time: e.start!.dateTime ?? `${e.start!.date}T00:00:00Z`,
      end_time: e.end!.dateTime ?? `${e.end!.date}T00:00:00Z`,
      is_busy: e.transparency !== 'transparent',
      synced_at: new Date().toISOString(),
    }));

  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from('calendar_events')
      .upsert(rows, { onConflict: 'user_id,google_event_id' });

    if (upsertError) {
      console.error('[/api/calendar/sync] upsert:', upsertError);
      return NextResponse.json({ error: 'Failed to cache events' }, { status: 500 });
    }
  }

  return NextResponse.json({ synced: rows.length });
}
