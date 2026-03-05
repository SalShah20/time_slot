import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { getCalendarClient, deleteCalendarEvent, getTimeSlotCalendarId, getPriorityColorId } from '@/lib/googleCalendar';
import { fallbackSchedule } from '@/lib/scheduleUtils';
import type { BusyInterval } from '@/lib/scheduleUtils';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const taskId = params.id;
  const body = await req.json() as {
    title?: string;
    description?: string;
    tag?: string;
    priority?: string;
    deadline?: string;
    estimatedMinutes?: number;
    scheduledStart?: string;
    timezone?: string;
  };

  const supabase = createSupabaseServer();

  // Fetch current task to verify ownership and get existing values.
  // Use select('*') so this never fails due to a missing column (e.g. google_event_id
  // before migration 007 is run). If we used an explicit column list and any column
  // didn't exist yet, Supabase would return a schema-cache error that we'd incorrectly
  // surface as "Task not found".
  const { data: existing, error: fetchError } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', user.id)
    .single();

  if (fetchError || !existing) {
    console.error('[PATCH /api/tasks/[id]] fetch error:', fetchError);
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const update: Record<string, unknown> = {};
  if (body.title !== undefined)            update.title             = body.title;
  if (body.description !== undefined)      update.description       = body.description || null;
  if (body.tag !== undefined)              update.tag               = body.tag || null;
  if (body.priority !== undefined)         update.priority          = body.priority || null;
  if (body.deadline !== undefined)         update.deadline          = body.deadline || null;
  if (body.estimatedMinutes !== undefined) update.estimated_minutes = body.estimatedMinutes;

  const newMinutes = body.estimatedMinutes ?? (existing.estimated_minutes as number);

  if (body.scheduledStart !== undefined) {
    update.scheduled_start = body.scheduledStart;
    update.scheduled_end   = new Date(new Date(body.scheduledStart).getTime() + newMinutes * 60_000).toISOString();
  } else if (body.estimatedMinutes !== undefined && existing.scheduled_start) {
    // Duration changed but start didn't — recompute end
    update.scheduled_end = new Date(
      new Date(existing.scheduled_start as string).getTime() + newMinutes * 60_000,
    ).toISOString();
  }

  // ── Deadline-driven reschedule ───────────────────────────────────────────────
  // If a deadline was added/changed and the user didn't manually pick a start time,
  // check whether the current scheduled slot misses the deadline and reschedule if so.
  const newDeadline   = body.deadline ? new Date(body.deadline) : null;
  const currentEnd    = (update.scheduled_end as string | undefined) ?? (existing.scheduled_end as string | null);
  const needsReschedule =
    body.deadline !== undefined &&   // deadline field was explicitly sent
    !body.scheduledStart &&          // user didn't also manually set a start time
    newDeadline &&
    currentEnd &&
    new Date(currentEnd) > newDeadline;

  if (needsReschedule) {
    const timezone = body.timezone ?? 'UTC';
    const now = new Date();
    const twoDaysOut = new Date(now.getTime() + 2 * 24 * 60 * 60_000);

    // Fetch other pending tasks + calendar events as busy intervals
    const [{ data: otherTasks }, { data: calEvents }] = await Promise.all([
      supabase
        .from('tasks')
        .select('scheduled_start, scheduled_end, estimated_minutes')
        .eq('user_id', user.id)
        .neq('id', taskId)
        .not('status', 'in', '("completed","cancelled")')
        .gte('scheduled_start', now.toISOString())
        .lt('scheduled_start', twoDaysOut.toISOString()),
      supabase
        .from('calendar_events')
        .select('start_time, end_time')
        .eq('user_id', user.id)
        .gte('start_time', now.toISOString())
        .lt('start_time', twoDaysOut.toISOString()),
    ]);

    const busyIntervals: BusyInterval[] = [
      ...(otherTasks ?? [])
        .filter((t) => t.scheduled_start)
        .map((t) => ({
          start: new Date(t.scheduled_start!),
          end: t.scheduled_end
            ? new Date(t.scheduled_end)
            : new Date(new Date(t.scheduled_start!).getTime() + (t.estimated_minutes ?? 30) * 60_000),
        })),
      ...(calEvents ?? []).map((e) => ({
        start: new Date(e.start_time),
        end: new Date(e.end_time),
      })),
    ];

    const slot = fallbackSchedule(busyIntervals, newMinutes, body.deadline, timezone);
    update.scheduled_start = slot.scheduled_start;
    update.scheduled_end   = slot.scheduled_end;
    update.needs_rescheduling = new Date(slot.scheduled_end) > newDeadline ? true : false;
    console.log(`[PATCH /api/tasks/[id]] Rescheduled "${existing.title as string}" to fit deadline: ${slot.scheduled_start}`);
  }

  // Sync GCal event whenever one exists — patch in-place so the event ID stays stable
  if (existing.google_event_id) {
    const [calendar, calId] = await Promise.all([
      getCalendarClient(supabase, user.id),
      getTimeSlotCalendarId(supabase, user.id),
    ]);
    if (calendar) {
      try {
        const finalStart    = (update.scheduled_start as string | undefined) ?? (existing.scheduled_start as string);
        const finalEnd      = (update.scheduled_end   as string | undefined) ?? (existing.scheduled_end   as string);
        const priorityValue = (update.priority as string | undefined) ?? (existing.priority as string | null);
        await calendar.events.patch({
          calendarId: calId,
          eventId:    existing.google_event_id as string,
          requestBody: {
            summary:     (update.title       as string | undefined) ?? (existing.title       as string),
            description: (update.description as string | undefined) ?? (existing.description as string | null) ?? '',
            start:       { dateTime: finalStart },
            end:         { dateTime: finalEnd },
            colorId:     getPriorityColorId(priorityValue),
          },
        });
      } catch (err) {
        console.warn('[PATCH /api/tasks/[id]] GCal event update failed:', err);
      }
    }
  }

  const { data, error } = await supabase
    .from('tasks')
    .update(update)
    .eq('id', taskId)
    .eq('user_id', user.id)
    .select('*')
    .single();

  if (error) {
    console.error('[PATCH /api/tasks/[id]]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const taskId = params.id;
  const supabase = createSupabaseServer();

  const { data: task, error: fetchError } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', user.id)
    .single();

  if (fetchError || !task) {
    console.error('[DELETE /api/tasks/[id]] fetch error:', fetchError);
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  // Collect all GCal event IDs to delete: this task + any split-session children
  // (DB cascade will delete the child rows, but won't touch GCal events)
  const gcalEventIds: string[] = [];
  if (task.google_event_id) gcalEventIds.push(task.google_event_id as string);

  const { data: children } = await supabase
    .from('tasks')
    .select('google_event_id')
    .eq('parent_task_id', taskId)
    .eq('user_id', user.id);

  for (const child of children ?? []) {
    if (child.google_event_id) gcalEventIds.push(child.google_event_id as string);
  }

  if (gcalEventIds.length > 0) {
    const [calendar, calId] = await Promise.all([
      getCalendarClient(supabase, user.id),
      getTimeSlotCalendarId(supabase, user.id),
    ]);
    if (calendar) {
      await Promise.all(gcalEventIds.map((eid) => deleteCalendarEvent(calendar, eid, calId)));
    }
  }

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', taskId)
    .eq('user_id', user.id);

  if (error) {
    console.error('[DELETE /api/tasks/[id]]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
