import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { createOAuthClient } from '@/lib/googleCalendar';

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

  const [{ data: manual }, { data: google }] = await Promise.all([
    supabase
      .from('calendar_blocks')
      .select('id, title, start_time, end_time, is_busy')
      .eq('user_id', user.id)
      .gte('start_time', startOfDay)
      .lt('start_time', endOfDay),
    supabase
      .from('calendar_events')
      .select('id, title, start_time, end_time, is_busy')
      .eq('user_id', user.id)
      .gte('start_time', startOfDay)
      .lt('start_time', endOfDay),
  ]);

  const blocks = [
    ...(manual ?? []).map((b) => ({ ...b, source: 'manual' as const })),
    ...(google  ?? []).map((b) => ({ ...b, source: 'google' as const })),
  ].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  return NextResponse.json(blocks);
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { title, start_time, end_time } = await req.json() as {
    title: string;
    start_time: string;
    end_time: string;
  };

  if (!title || !start_time || !end_time) {
    return NextResponse.json({ error: 'title, start_time, end_time are required' }, { status: 400 });
  }

  const supabase = createSupabaseServer();
  const { data, error } = await supabase
    .from('calendar_blocks')
    .insert({ user_id: user.id, title, start_time, end_time })
    .select()
    .single();

  if (error) {
    console.error('[POST /api/blocks]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Try to mirror the block to Google Calendar — non-fatal if it fails
  let gcal_warning = false;
  try {
    const { data: tokenRow } = await supabase
      .from('user_tokens')
      .select('google_access_token, google_refresh_token, google_token_expiry')
      .eq('user_id', user.id)
      .single();

    if (tokenRow?.google_access_token) {
      const oauth2Client = createOAuthClient();
      oauth2Client.setCredentials({
        access_token: tokenRow.google_access_token,
        refresh_token: tokenRow.google_refresh_token ?? undefined,
        expiry_date: tokenRow.google_token_expiry
          ? new Date(tokenRow.google_token_expiry).getTime()
          : undefined,
      });
      const cal = google.calendar({ version: 'v3', auth: oauth2Client });
      await cal.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: title,
          start: { dateTime: start_time },
          end:   { dateTime: end_time },
          colorId: '8', // Graphite — distinguishes manual blocks from teal tasks
        },
      });
    }
  } catch (err) {
    console.error('[POST /api/blocks] Google Calendar sync failed:', err);
    gcal_warning = true;
  }

  return NextResponse.json({ ...data, source: 'manual', gcal_warning });
}
