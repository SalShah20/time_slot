import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createOAuthClient, deleteCalendarEvent } from '@/lib/googleCalendar';
import { createSupabaseAdmin } from '@/lib/supabase-server';
import { fallbackSchedule, localTimeOnDay } from '@/lib/scheduleUtils';
import { getTagColor } from '@/lib/tagColors';
import type { BusyInterval } from '@/lib/scheduleUtils';

interface PendingTaskRow {
  id: string;
  title: string;
  description: string | null;
  tag: string | null;
  estimated_minutes: number | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  deadline: string | null;
  status: string;
  google_event_id: string | null;
}

// Google sends HEAD to validate the webhook endpoint
export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

function overlaps(taskStart: Date, taskEnd: Date, evStart: Date, evEnd: Date): boolean {
  return evStart < taskEnd && evEnd > taskStart;
}

export async function POST(req: NextRequest) {
  // Always return 200 to Google — never let errors produce 4xx/5xx
  try {
    const channelId = req.headers.get('x-goog-channel-id');
    const userId    = req.headers.get('x-goog-channel-token');

    if (!channelId || !userId) {
      return new NextResponse(null, { status: 200 });
    }

    const supabase = createSupabaseAdmin();

    // Validate channel belongs to this user
    const { data: tokenRow } = await supabase
      .from('user_tokens')
      .select('google_access_token, google_refresh_token, google_token_expiry, webhook_channel_id')
      .eq('user_id', userId)
      .single();

    if (!tokenRow?.webhook_channel_id || tokenRow.webhook_channel_id !== channelId) {
      // Not our channel — ignore silently
      return new NextResponse(null, { status: 200 });
    }

    if (!tokenRow.google_access_token) {
      return new NextResponse(null, { status: 200 });
    }

    // Build GCal client
    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials({
      access_token:  tokenRow.google_access_token,
      refresh_token: tokenRow.google_refresh_token ?? undefined,
      expiry_date:   tokenRow.google_token_expiry
        ? new Date(tokenRow.google_token_expiry).getTime()
        : undefined,
    });

    // Persist refreshed tokens automatically
    oauth2Client.on('tokens', async (tokens) => {
      await supabase.from('user_tokens').update({
        google_access_token:  tokens.access_token ?? tokenRow.google_access_token,
        google_refresh_token: tokens.refresh_token ?? tokenRow.google_refresh_token,
        google_token_expiry:  tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : tokenRow.google_token_expiry,
      }).eq('user_id', userId);
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Use UTC for simplicity in the webhook (no user timezone available)
    const timezone = 'UTC';
    const now = new Date();
    const startOfDay = localTimeOnDay(now, 0, 0, timezone, 0).toISOString();
    const endOfDay   = localTimeOnDay(now, 0, 0, timezone, 2).toISOString();

    // Fetch today+tomorrow events from Google
    let response;
    try {
      response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: startOfDay,
        timeMax: endOfDay,
        singleEvents: true,
        orderBy: 'startTime',
      });
    } catch (err) {
      console.warn('[/api/calendar/webhook] GCal fetch failed:', err);
      return new NextResponse(null, { status: 200 });
    }

    const events = response.data.items ?? [];

    // Upsert events into calendar_events cache
    const rows = events
      .filter((e) => e.id && (e.start?.dateTime || e.start?.date))
      .map((e) => ({
        user_id:        userId,
        google_event_id: e.id!,
        title:          e.summary ?? null,
        start_time:     e.start!.dateTime ?? (() => {
          const [y, m, d] = e.start!.date!.split('-').map(Number);
          return new Date(y, m - 1, d).toISOString();
        })(),
        end_time:       e.end!.dateTime ?? (() => {
          const [y, m, d] = e.end!.date!.split('-').map(Number);
          return new Date(y, m - 1, d).toISOString();
        })(),
        is_busy:        e.transparency !== 'transparent',
        synced_at:      new Date().toISOString(),
      }));

    if (rows.length > 0) {
      await supabase.from('calendar_events')
        .upsert(rows, { onConflict: 'user_id,google_event_id' });
    }

    // Delete stale entries
    const freshIds = rows.map((r) => r.google_event_id);
    if (freshIds.length > 0) {
      const { data: existing } = await supabase
        .from('calendar_events')
        .select('id, google_event_id')
        .eq('user_id', userId)
        .gte('start_time', startOfDay)
        .lt('start_time', endOfDay);

      const freshIdSet = new Set(freshIds);
      const staleRowIds = (existing ?? [])
        .filter((e: { id: string; google_event_id: string }) => !freshIdSet.has(e.google_event_id))
        .map((e: { id: string; google_event_id: string }) => e.id as string);

      if (staleRowIds.length > 0) {
        await supabase.from('calendar_events').delete().in('id', staleRowIds);
      }
    }

    // --- Conflict rescheduling (same logic as reschedule route) ---

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysOut   = localTimeOnDay(now, 0, 0, timezone, 2).toISOString();
    const todayStart   = localTimeOnDay(now, 0, 0, timezone, 0).toISOString();

    const { data: pendingTasks } = await supabase
      .from('tasks')
      .select('id, title, description, tag, estimated_minutes, scheduled_start, scheduled_end, deadline, status, google_event_id')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .gte('scheduled_start', sevenDaysAgo)
      .lt('scheduled_start', twoDaysOut)
      .order('scheduled_start', { ascending: true });

    const { data: calEvents } = await supabase
      .from('calendar_events')
      .select('start_time, end_time, is_busy')
      .eq('user_id', userId)
      .eq('is_busy', true)
      .gte('start_time', todayStart)
      .lt('start_time', twoDaysOut);

    const calIntervals: BusyInterval[] = (calEvents ?? []).map((e: { start_time: string; end_time: string }) => ({
      start: new Date(e.start_time),
      end:   new Date(e.end_time),
    }));

    const typedTasks = (pendingTasks ?? []) as PendingTaskRow[];
    for (const task of typedTasks) {
      try {
        if (!task.scheduled_start) continue;

        const taskStart = new Date(task.scheduled_start);
        const taskEnd   = task.scheduled_end
          ? new Date(task.scheduled_end)
          : new Date(taskStart.getTime() + (task.estimated_minutes ?? 30) * 60_000);

        const otherTaskIntervals: BusyInterval[] = typedTasks
          .filter((t) => t.id !== task.id && t.scheduled_start)
          .map((t) => ({
            start: new Date(t.scheduled_start!),
            end:   t.scheduled_end
              ? new Date(t.scheduled_end)
              : new Date(new Date(t.scheduled_start!).getTime() + (t.estimated_minutes ?? 30) * 60_000),
          }));

        const allBusy = [...calIntervals, ...otherTaskIntervals];
        const hasConflict = allBusy.some((iv) => overlaps(taskStart, taskEnd, iv.start, iv.end));
        const isPastDue   = taskStart < now;
        if (!hasConflict && !isPastDue) continue;

        const { scheduled_start, scheduled_end } = fallbackSchedule(
          allBusy,
          task.estimated_minutes ?? 30,
          task.deadline,
          timezone,
        );

        // Check deadline feasibility
        if (task.deadline && new Date(scheduled_start) > new Date(task.deadline)) {
          await supabase.from('tasks')
            .update({ needs_rescheduling: true })
            .eq('id', task.id).eq('user_id', userId);
          console.warn(`[/api/calendar/webhook] No slot before deadline for "${task.title}" — flagged`);
          continue;
        }

        let newEventId: string | null = null;
        if (task.google_event_id) {
          await deleteCalendarEvent(calendar, task.google_event_id);
        }
        try {
          const tagColor = getTagColor(task.tag ?? undefined);
          const gcalEvent = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: {
              summary:     task.title,
              description: task.description ?? '',
              start:       { dateTime: scheduled_start },
              end:         { dateTime: scheduled_end },
              colorId:     tagColor.gcalColorId,
            },
          });
          newEventId = gcalEvent.data.id ?? null;
        } catch (err) {
          console.warn(`[/api/calendar/webhook] GCal event recreation failed for task ${task.id}:`, err);
        }

        const updatePayload: Record<string, unknown> = {
          scheduled_start,
          scheduled_end,
          needs_rescheduling: false,
        };
        if (newEventId) updatePayload.google_event_id = newEventId;

        await supabase.from('tasks')
          .update(updatePayload)
          .eq('id', task.id).eq('user_id', userId);

        // Update local array so subsequent tasks see new slot as occupied
        task.scheduled_start = scheduled_start;
        task.scheduled_end   = scheduled_end;
        if (newEventId) task.google_event_id = newEventId;

        console.log(`[/api/calendar/webhook] "${task.title}" rescheduled to ${scheduled_start}`);
      } catch (err) {
        console.error(`[/api/calendar/webhook] Error processing task ${task.id}:`, err);
      }
    }

    return new NextResponse(null, { status: 200 });
  } catch (err) {
    // Always 200 — never let errors reach Google
    console.error('[/api/calendar/webhook] Unexpected error:', err);
    return new NextResponse(null, { status: 200 });
  }
}
