import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { getCalendarClient, deleteCalendarEvent } from '@/lib/googleCalendar';
import { getTagColor } from '@/lib/tagColors';
import { fallbackSchedule } from '@/lib/scheduleUtils';
import type { BusyInterval } from '@/lib/scheduleUtils';

function overlaps(
  taskStart: Date,
  taskEnd: Date,
  eventStart: Date,
  eventEnd: Date,
): boolean {
  return eventStart < taskEnd && eventEnd > taskStart;
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let timezone = 'UTC';
  try {
    const body = await req.json() as { timezone?: string };
    timezone = body.timezone ?? 'UTC';
  } catch { /* no body */ }

  const supabase = createSupabaseServer();

  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const twoDaysOut = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).toISOString();

  // Fetch all pending tasks (skip in_progress — don't interrupt active work)
  const { data: pendingTasks, error: tasksError } = await supabase
    .from('tasks')
    .select('id, title, description, tag, estimated_minutes, scheduled_start, scheduled_end, deadline, status, google_event_id')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .gte('scheduled_start', todayStart)
    .lt('scheduled_start', twoDaysOut)
    .order('scheduled_start', { ascending: true });

  if (tasksError) {
    return NextResponse.json({ error: tasksError.message }, { status: 500 });
  }

  // Fetch all calendar events for today+tomorrow
  const { data: calEvents, error: eventsError } = await supabase
    .from('calendar_events')
    .select('title, start_time, end_time, is_busy')
    .eq('user_id', user.id)
    .eq('is_busy', true)
    .gte('start_time', todayStart)
    .lt('start_time', twoDaysOut);

  if (eventsError) {
    return NextResponse.json({ error: eventsError.message }, { status: 500 });
  }

  const calIntervals: BusyInterval[] = (calEvents ?? []).map((e) => ({
    start: new Date(e.start_time),
    end: new Date(e.end_time),
  }));

  // Get GCal client once (null if calendar not connected)
  const calendar = await getCalendarClient(supabase, user.id);

  const rescheduled: { id: string; title: string; scheduled_start: string; scheduled_end: string }[] = [];

  for (const task of pendingTasks ?? []) {
    try {
      if (!task.scheduled_start) continue;

      const taskStart = new Date(task.scheduled_start);
      const taskEnd   = task.scheduled_end
        ? new Date(task.scheduled_end)
        : new Date(taskStart.getTime() + (task.estimated_minutes ?? 30) * 60_000);

      // Build busy intervals = all calendar events + all OTHER pending tasks (except the one we're rescheduling)
      const otherTaskIntervals: BusyInterval[] = (pendingTasks ?? [])
        .filter((t) => t.id !== task.id && t.scheduled_start)
        .map((t) => ({
          start: new Date(t.scheduled_start!),
          end: t.scheduled_end
            ? new Date(t.scheduled_end)
            : new Date(new Date(t.scheduled_start!).getTime() + (t.estimated_minutes ?? 30) * 60_000),
        }));

      const allBusy = [...calIntervals, ...otherTaskIntervals];

      // Check if this task conflicts with any GCal event OR another pending task
      const hasConflict = allBusy.some((iv) => overlaps(taskStart, taskEnd, iv.start, iv.end));
      if (!hasConflict) continue;

      const { scheduled_start, scheduled_end } = fallbackSchedule(
        allBusy,
        task.estimated_minutes ?? 30,
        task.deadline,
        timezone,
      );

      // Delete old GCal event and create a new one with updated time
      let newEventId: string | null = null;
      if (calendar) {
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
          console.warn(`[/api/tasks/reschedule] GCal event recreation failed for task ${task.id}:`, err);
        }
      }

      const updatePayload: Record<string, unknown> = { scheduled_start, scheduled_end };
      if (newEventId) updatePayload.google_event_id = newEventId;

      const { error: updateError } = await supabase
        .from('tasks')
        .update(updatePayload)
        .eq('id', task.id)
        .eq('user_id', user.id);

      if (!updateError) {
        // Update in our local array so subsequent tasks see the new slot as occupied
        task.scheduled_start = scheduled_start;
        task.scheduled_end   = scheduled_end;
        if (newEventId) task.google_event_id = newEventId;
        rescheduled.push({ id: task.id, title: task.title, scheduled_start, scheduled_end });
        console.log(`[/api/tasks/reschedule] "${task.title}" moved to ${scheduled_start}`);
      } else {
        console.error(`[/api/tasks/reschedule] Failed to update task ${task.id}:`, updateError);
      }
    } catch (err) {
      console.error(`[/api/tasks/reschedule] Unexpected error processing task ${task.id}:`, err);
    }
  }

  return NextResponse.json({ rescheduled: rescheduled.length, tasks: rescheduled });
}
