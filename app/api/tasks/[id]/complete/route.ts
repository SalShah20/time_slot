import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { getCalendarClient, deleteCalendarEvent, getTimeSlotCalendarId } from '@/lib/googleCalendar';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();

  // Fetch google_event_id before completing so we can clean up GCal
  const { data: taskRow } = await supabase
    .from('tasks')
    .select('google_event_id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();

  const { data, error } = await supabase
    .from('tasks')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) {
    console.error('[POST /api/tasks/[id]/complete]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Delete Google Calendar event — non-fatal
  const googleEventId = (taskRow as Record<string, unknown> | null)?.google_event_id as string | null;
  if (googleEventId) {
    try {
      const [calendar, calId] = await Promise.all([
        getCalendarClient(supabase, user.id),
        getTimeSlotCalendarId(supabase, user.id),
      ]);
      if (calendar) await deleteCalendarEvent(calendar, googleEventId, calId);
    } catch (err) {
      console.warn('[POST /api/tasks/[id]/complete] GCal cleanup failed:', err);
    }
    // Remove from local cache so ScheduleView reflects the change immediately
    await supabase
      .from('calendar_events')
      .delete()
      .eq('user_id', user.id)
      .eq('google_event_id', googleEventId);
  }

  return NextResponse.json(data);
}
