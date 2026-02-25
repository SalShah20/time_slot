import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { taskId, startedAt, estimatedMinutes, taskTitle } = await req.json();

  if (!taskId || !startedAt || !estimatedMinutes) {
    return NextResponse.json({ error: 'taskId, startedAt, estimatedMinutes are required' }, { status: 400 });
  }

  const supabase = createSupabaseServer();

  // Upsert active_timers — ON CONFLICT (user_id) overwrites any existing timer.
  // This enforces the one-active-timer-per-user invariant.
  const { error: upsertError } = await supabase
    .from('active_timers')
    .upsert(
      {
        user_id: user.id,
        task_id: taskId,
        state: 'WORKING',
        started_at: startedAt,
        paused_at: null,
        current_break_started_at: null,
        total_break_seconds: 0,
        estimated_minutes: estimatedMinutes,
        task_title: taskTitle ?? '',
      },
      { onConflict: 'user_id' }
    );

  if (upsertError) {
    console.error('[/api/timer/start] upsert active_timers', upsertError);
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  // Mark task as in_progress
  const { error: taskError } = await supabase
    .from('tasks')
    .update({ status: 'in_progress' })
    .eq('id', taskId);

  if (taskError) {
    console.error('[/api/timer/start] update task status', taskError);
    // Non-fatal — timer is already recorded
  }

  // Open a work session (ended_at=null means in-progress)
  const { error: sessionError } = await supabase.from('timer_sessions').insert({
    task_id: taskId,
    user_id: user.id,
    type: 'work',
    started_at: startedAt,
    ended_at: null,
    duration: null,
  });

  if (sessionError) {
    console.error('[/api/timer/start] insert timer_session', sessionError);
  }

  return NextResponse.json({ ok: true });
}
