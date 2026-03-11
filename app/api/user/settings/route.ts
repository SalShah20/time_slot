import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();
  const { data, error } = await supabase
    .from('user_tokens')
    .select('work_start_hour, work_end_hour, work_end_late_hour')
    .eq('user_id', user.id)
    .single();

  if (error || !data) {
    // No row yet — return defaults
    return NextResponse.json({
      workStartHour: 8,
      workEndHour: 23,
      workEndLateHour: 3,
    });
  }

  return NextResponse.json({
    workStartHour: data.work_start_hour ?? 8,
    workEndHour: data.work_end_hour ?? 23,
    workEndLateHour: data.work_end_late_hour ?? 3,
  });
}

export async function PATCH(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as {
    workStartHour?: number;
    workEndHour?: number;
    workEndLateHour?: number;
  };

  const { workStartHour, workEndHour, workEndLateHour } = body;

  // Validate types
  if (
    typeof workStartHour !== 'number' ||
    typeof workEndHour !== 'number' ||
    typeof workEndLateHour !== 'number'
  ) {
    return NextResponse.json({ error: 'All fields must be numbers' }, { status: 400 });
  }

  // Validate ranges
  if (!Number.isInteger(workStartHour) || workStartHour < 0 || workStartHour > 23) {
    return NextResponse.json({ error: 'workStartHour must be 0–23' }, { status: 400 });
  }
  if (!Number.isInteger(workEndHour) || workEndHour < 0 || workEndHour > 23) {
    return NextResponse.json({ error: 'workEndHour must be 0–23' }, { status: 400 });
  }
  if (!Number.isInteger(workEndLateHour) || workEndLateHour < 0 || workEndLateHour > 6) {
    return NextResponse.json({ error: 'workEndLateHour must be 0–6' }, { status: 400 });
  }

  // Validate logical ordering: start < end
  if (workStartHour >= workEndHour) {
    return NextResponse.json({ error: 'Start hour must be before end hour' }, { status: 400 });
  }

  const supabase = createSupabaseServer();
  const { error } = await supabase
    .from('user_tokens')
    .update({
      work_start_hour: workStartHour,
      work_end_hour: workEndHour,
      work_end_late_hour: workEndLateHour,
    })
    .eq('user_id', user.id);

  if (error) {
    console.error('[/api/user/settings] update error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ workStartHour, workEndHour, workEndLateHour });
}
