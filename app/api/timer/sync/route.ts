import { NextRequest, NextResponse } from 'next/server';
import { supabase, PLACEHOLDER_USER_ID } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const body = await req.json();

  const {
    state,
    taskId,
    startedAt,
    pausedAt,
    currentBreakStartedAt,
    totalBreakSeconds,
    estimatedMinutes,
    taskTitle,
  } = body;

  const { error } = await supabase
    .from('active_timers')
    .update({
      state,
      task_id: taskId,
      started_at: startedAt,
      paused_at: pausedAt ?? null,
      current_break_started_at: currentBreakStartedAt ?? null,
      total_break_seconds: totalBreakSeconds ?? 0,
      estimated_minutes: estimatedMinutes,
      task_title: taskTitle ?? '',
    })
    .eq('user_id', PLACEHOLDER_USER_ID);

  if (error) {
    console.error('[/api/timer/sync]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ serverTime: new Date().toISOString() });
}
