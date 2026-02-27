import { NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
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

export async function POST() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();

  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const twoDaysOut = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).toISOString();

  // Fetch all pending tasks (skip in_progress — don't interrupt active work)
  const { data: pendingTasks, error: tasksError } = await supabase
    .from('tasks')
    .select('id, title, estimated_minutes, scheduled_start, scheduled_end, deadline, status')
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

  const rescheduled: { id: string; title: string; scheduled_start: string; scheduled_end: string }[] = [];

  for (const task of pendingTasks ?? []) {
    if (!task.scheduled_start) continue;

    const taskStart = new Date(task.scheduled_start);
    const taskEnd   = task.scheduled_end
      ? new Date(task.scheduled_end)
      : new Date(taskStart.getTime() + task.estimated_minutes * 60_000);

    // Check if this task conflicts with any busy calendar event
    const hasConflict = calIntervals.some((iv) => overlaps(taskStart, taskEnd, iv.start, iv.end));
    if (!hasConflict) continue;

    // Build busy intervals = all calendar events + all OTHER pending tasks (except the one we're rescheduling)
    const otherTaskIntervals: BusyInterval[] = (pendingTasks ?? [])
      .filter((t) => t.id !== task.id && t.scheduled_start)
      .map((t) => ({
        start: new Date(t.scheduled_start!),
        end: t.scheduled_end
          ? new Date(t.scheduled_end)
          : new Date(new Date(t.scheduled_start!).getTime() + t.estimated_minutes * 60_000),
      }));

    const allBusy = [...calIntervals, ...otherTaskIntervals];

    const { scheduled_start, scheduled_end } = fallbackSchedule(
      allBusy,
      task.estimated_minutes,
      task.deadline,
    );

    const { error: updateError } = await supabase
      .from('tasks')
      .update({ scheduled_start, scheduled_end })
      .eq('id', task.id)
      .eq('user_id', user.id);

    if (!updateError) {
      // Update in our local array so subsequent tasks see the new slot as occupied
      task.scheduled_start = scheduled_start;
      task.scheduled_end   = scheduled_end;
      rescheduled.push({ id: task.id, title: task.title, scheduled_start, scheduled_end });
      console.log(`[/api/tasks/reschedule] "${task.title}" moved to ${scheduled_start}`);
    } else {
      console.error(`[/api/tasks/reschedule] Failed to update task ${task.id}:`, updateError);
    }
  }

  return NextResponse.json({ rescheduled: rescheduled.length, tasks: rescheduled });
}
