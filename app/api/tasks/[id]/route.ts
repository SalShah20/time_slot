import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { getCalendarClient, deleteCalendarEvent } from '@/lib/googleCalendar';
import { getTagColor } from '@/lib/tagColors';

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

  // Fetch current task to verify ownership and get existing values
  const { data: existing, error: fetchError } = await supabase
    .from('tasks')
    .select('id, title, description, tag, scheduled_start, scheduled_end, estimated_minutes, deadline, priority, google_event_id, status')
    .eq('id', taskId)
    .eq('user_id', user.id)
    .single();

  if (fetchError || !existing) {
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
  const timeChanged = body.scheduledStart !== undefined || body.estimatedMinutes !== undefined;

  if (body.scheduledStart !== undefined) {
    update.scheduled_start = body.scheduledStart;
    update.scheduled_end   = new Date(new Date(body.scheduledStart).getTime() + newMinutes * 60_000).toISOString();
  } else if (body.estimatedMinutes !== undefined && existing.scheduled_start) {
    // Duration changed but start didn't — recompute end
    update.scheduled_end = new Date(
      new Date(existing.scheduled_start as string).getTime() + newMinutes * 60_000,
    ).toISOString();
  }

  // Update GCal event if time or duration changed
  if (timeChanged && existing.google_event_id) {
    const calendar = await getCalendarClient(supabase, user.id);
    if (calendar) {
      await deleteCalendarEvent(calendar, existing.google_event_id as string);
      try {
        const finalStart = (update.scheduled_start as string | undefined) ?? (existing.scheduled_start as string);
        const finalEnd   = (update.scheduled_end   as string | undefined) ?? (existing.scheduled_end   as string);
        const tagValue   = (update.tag as string | undefined) ?? (existing.tag as string | null) ?? undefined;
        const tagColor   = getTagColor(tagValue);
        const gcalEvent  = await calendar.events.insert({
          calendarId: 'primary',
          requestBody: {
            summary:     (update.title       as string | undefined) ?? (existing.title       as string),
            description: (update.description as string | undefined) ?? (existing.description as string | null) ?? '',
            start:       { dateTime: finalStart },
            end:         { dateTime: finalEnd },
            colorId:     tagColor.gcalColorId,
          },
        });
        if (gcalEvent.data.id) update.google_event_id = gcalEvent.data.id;
      } catch (err) {
        console.warn('[PATCH /api/tasks/[id]] GCal event recreation failed:', err);
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
    .select('id, google_event_id')
    .eq('id', taskId)
    .eq('user_id', user.id)
    .single();

  if (fetchError || !task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  if (task.google_event_id) {
    const calendar = await getCalendarClient(supabase, user.id);
    if (calendar) await deleteCalendarEvent(calendar, task.google_event_id as string);
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
