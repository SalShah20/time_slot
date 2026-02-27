import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { getCalendarClient, deleteCalendarEvent } from '@/lib/googleCalendar';
import type { LocalSession } from '@/types/timer';

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // totalBreakSeconds is received but stored implicitly via sessions durations
  const body = await req.json() as {
    taskId: string;
    actualWorkSeconds: number;
    totalBreakSeconds: number;
    sessions: LocalSession[];
  };
  const { taskId, actualWorkSeconds, sessions } = body;

  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  const supabase = createSupabaseServer();

  // Fetch google_event_id before completing so we can clean up GCal
  const { data: taskRow } = await supabase
    .from('tasks')
    .select('google_event_id')
    .eq('id', taskId)
    .single();

  // 1. Update task: mark completed + set actual_duration
  const { error: taskError } = await supabase
    .from('tasks')
    .update({
      status: 'completed',
      actual_duration: actualWorkSeconds,
    })
    .eq('id', taskId);

  if (taskError) {
    console.error('[/api/timer/complete] update task', taskError);
    return NextResponse.json({ error: taskError.message }, { status: 500 });
  }

  // 2. Delete active_timers row
  const { error: deleteError } = await supabase
    .from('active_timers')
    .delete()
    .eq('user_id', user.id);

  if (deleteError) {
    console.error('[/api/timer/complete] delete active_timers', deleteError);
  }

  // 3. Bulk-insert all sessions (close any open ones)
  if (sessions && sessions.length > 0) {
    const now = new Date().toISOString();
    const rows = sessions.map((s: LocalSession) => {
      const endedAt = s.endedAt ?? now;
      const durationSeconds = Math.floor(
        (new Date(endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000
      );
      return {
        task_id: taskId,
        user_id: user.id,
        type: s.type,
        started_at: s.startedAt,
        ended_at: endedAt,
        duration: durationSeconds,
      };
    });

    const { error: sessionError } = await supabase.from('timer_sessions').insert(rows);
    if (sessionError) {
      console.error('[/api/timer/complete] insert timer_sessions', sessionError);
      // Non-fatal — task is already completed
    }
  }

  // 4. Delete Google Calendar event — non-fatal
  const googleEventId = (taskRow as Record<string, unknown> | null)?.google_event_id as string | null;
  if (googleEventId) {
    try {
      const calendar = await getCalendarClient(supabase, user.id);
      if (calendar) await deleteCalendarEvent(calendar, googleEventId);
    } catch (err) {
      console.warn('[/api/timer/complete] GCal cleanup failed:', err);
    }
  }

  return NextResponse.json({ ok: true });
}
