import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { createOAuthClient } from '@/lib/googleCalendar';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Find the first available start time for a new task today.
 *  Respects both existing app tasks AND cached Google Calendar events. */
async function findNextSlot(
  supabase: SupabaseClient,
  userId: string,
  estimatedMinutes: number
): Promise<string> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0, 0);
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0);

  const [{ data: todayTasks }, { data: calEvents }] = await Promise.all([
    supabase
      .from('tasks')
      .select('scheduled_start, scheduled_end, estimated_minutes')
      .eq('user_id', userId)
      .not('status', 'in', '("completed","cancelled")')
      .gte('scheduled_start', todayStart.toISOString())
      .lt('scheduled_start', todayEnd.toISOString()),
    supabase
      .from('calendar_events')
      .select('start_time, end_time')
      .eq('user_id', userId)
      .gte('start_time', todayStart.toISOString())
      .lt('start_time', todayEnd.toISOString()),
  ]);

  // Build all busy intervals from tasks + Google Calendar events
  const busyIntervals = [
    ...(todayTasks ?? []).map((t) => ({
      start: new Date(t.scheduled_start!),
      end: t.scheduled_end
        ? new Date(t.scheduled_end)
        : new Date(new Date(t.scheduled_start!).getTime() + t.estimated_minutes * 60_000),
    })),
    ...(calEvents ?? []).map((e) => ({
      start: new Date(e.start_time),
      end: new Date(e.end_time),
    })),
  ].sort((a, b) => a.start.getTime() - b.start.getTime());

  // Start candidate: now or 7am, whichever is later
  let candidateStart = now > todayStart ? now : todayStart;

  // Iteratively push past any overlapping busy interval
  let changed = true;
  while (changed) {
    changed = false;
    for (const interval of busyIntervals) {
      const proposedEnd = new Date(candidateStart.getTime() + estimatedMinutes * 60_000);
      if (interval.start < proposedEnd && interval.end > candidateStart) {
        candidateStart = interval.end;
        changed = true;
      }
    }
  }

  // Don't schedule past 9pm — fall back to next morning 8am
  const cutoff = new Date(todayEnd.getTime() - estimatedMinutes * 60_000);
  if (candidateStart > cutoff) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0);
    candidateStart = tomorrow;
  }

  return candidateStart.toISOString();
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const {
    title,
    description,
    tag,
    estimatedMinutes,
    priority,
    deadline,
  } = await req.json() as {
    title: string;
    description?: string;
    tag?: string;
    estimatedMinutes: number;
    priority?: string;
    deadline?: string;
  };

  if (!title || !estimatedMinutes) {
    return NextResponse.json(
      { error: 'title and estimatedMinutes are required' },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServer();
  const scheduledStart = await findNextSlot(supabase, user.id, estimatedMinutes);
  const scheduledEnd = new Date(
    new Date(scheduledStart).getTime() + estimatedMinutes * 60_000
  ).toISOString();

  const baseInsert = {
    user_id: user.id,
    title,
    description: description ?? null,
    tag: tag ?? null,
    estimated_minutes: estimatedMinutes,
    priority: priority ?? null,
    deadline: deadline ?? null,
    scheduled_start: scheduledStart,
    status: 'pending',
  };

  let { data, error } = await supabase
    .from('tasks')
    .insert({ ...baseInsert, scheduled_end: scheduledEnd })
    .select('*')
    .single();

  // PGRST204 = column not found in schema cache (migration not yet run).
  // Fall back to inserting without optional columns so tasks can still be created.
  if (error?.code === 'PGRST204') {
    const missingCol = error.message.match(/the '(\w+)' column/)?.[1];
    console.warn(`[/api/tasks/create] Column "${missingCol}" missing — run migration 005. Retrying without optional fields.`);
    ({ data, error } = await supabase
      .from('tasks')
      .insert(baseInsert)
      .select('id, user_id, title, estimated_minutes, deadline, scheduled_start, status, created_at, updated_at')
      .single());
    // Attach computed values so the response is complete even without DB columns
    if (data) {
      (data as Record<string, unknown>).scheduled_end = scheduledEnd;
      (data as Record<string, unknown>).description   = description ?? null;
      (data as Record<string, unknown>).tag           = tag ?? null;
      (data as Record<string, unknown>).priority      = priority ?? null;
    }
  }

  if (error) {
    console.error('[/api/tasks/create]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Try to create a Google Calendar event — non-fatal if it fails
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
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: title,
          description: description ?? '',
          start: { dateTime: scheduledStart },
          end: { dateTime: scheduledEnd },
          colorId: '7', // Peacock (teal)
        },
      });
    }
  } catch (err) {
    console.error('[/api/tasks/create] Google Calendar event creation:', err);
    // Non-fatal — task is already saved
  }

  return NextResponse.json(data);
}
