import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Find the first available start time for a new task today.
 *  Simple v1: schedule after the last existing task's end time. */
async function findNextSlot(
  supabase: SupabaseClient,
  userId: string,
  estimatedMinutes: number
): Promise<string> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0, 0);
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0);

  const { data: todayTasks } = await supabase
    .from('tasks')
    .select('scheduled_start, scheduled_end, estimated_minutes')
    .eq('user_id', userId)
    .not('status', 'in', '("completed","cancelled")')
    .gte('scheduled_start', todayStart.toISOString())
    .lt('scheduled_start', todayEnd.toISOString())
    .order('scheduled_start', { ascending: true });

  // Candidate: after now or 7am, whichever is later
  let candidateStart = now > todayStart ? now : todayStart;

  if (todayTasks && todayTasks.length > 0) {
    for (const task of todayTasks) {
      if (!task.scheduled_start) continue;
      const taskEnd = task.scheduled_end
        ? new Date(task.scheduled_end)
        : new Date(new Date(task.scheduled_start).getTime() + task.estimated_minutes * 60_000);
      if (taskEnd > candidateStart) {
        candidateStart = taskEnd;
      }
    }
  }

  // Don't schedule past 9pm
  const cutoff = new Date(todayEnd.getTime() - estimatedMinutes * 60_000);
  if (candidateStart > cutoff) {
    // Fall back to next morning 8am
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

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id: user.id,
      title,
      description: description ?? null,
      tag: tag ?? null,
      estimated_minutes: estimatedMinutes,
      priority: priority ?? null,
      deadline: deadline ?? null,
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
      status: 'pending',
    })
    .select('*')
    .single();

  if (error) {
    console.error('[/api/tasks/create]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
