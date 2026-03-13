import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();
  const { data, error } = await supabase
    .from('user_tokens')
    .select('work_start_hour, work_end_hour, work_end_late_hour, work_timezone')
    .eq('user_id', user.id)
    .single();

  if (error || !data) {
    // No row yet — return defaults
    return NextResponse.json({
      workStartHour: 8,
      workEndHour: 23,
      workEndLateHour: 3,
      timezone: null,
    });
  }

  return NextResponse.json({
    workStartHour: data.work_start_hour ?? 8,
    workEndHour: data.work_end_hour ?? 23,
    workEndLateHour: data.work_end_late_hour ?? 3,
    timezone: data.work_timezone ?? null,
  });
}

function isValidHalfHour(n: number): boolean {
  return typeof n === 'number' && isFinite(n) && n % 0.5 === 0;
}

export async function PATCH(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as {
    workStartHour?: number;
    workEndHour?: number;
    workEndLateHour?: number;
    timezone?: string;
  };

  const { workStartHour, workEndHour, workEndLateHour, timezone } = body;

  // Validate types
  if (
    typeof workStartHour !== 'number' ||
    typeof workEndHour !== 'number' ||
    typeof workEndLateHour !== 'number'
  ) {
    return NextResponse.json({ error: 'All hour fields must be numbers' }, { status: 400 });
  }

  // Validate 30-min increments
  if (!isValidHalfHour(workStartHour) || !isValidHalfHour(workEndHour) || !isValidHalfHour(workEndLateHour)) {
    return NextResponse.json({ error: 'Hours must be in 30-minute increments' }, { status: 400 });
  }

  // Validate ranges
  if (workStartHour < 0 || workStartHour > 23.5) {
    return NextResponse.json({ error: 'Start hour must be 0–23.5' }, { status: 400 });
  }
  // workEndHour can be up to 24 (midnight = end of day)
  if (workEndHour < 0 || workEndHour > 24) {
    return NextResponse.json({ error: 'End hour must be 0–24' }, { status: 400 });
  }
  if (workEndLateHour < 0 || workEndLateHour > 6) {
    return NextResponse.json({ error: 'Late hour must be 0–6' }, { status: 400 });
  }

  // Validate logical ordering: start < end (preferred window must be positive)
  if (workStartHour >= workEndHour) {
    return NextResponse.json({ error: 'Start hour must be before end hour' }, { status: 400 });
  }

  // Validate timezone if provided
  if (timezone) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      return NextResponse.json({ error: `Invalid timezone: "${timezone}"` }, { status: 400 });
    }
  }

  const supabase = createSupabaseServer();

  const updatePayload: Record<string, unknown> = {
    work_start_hour: workStartHour,
    work_end_hour: workEndHour,
    work_end_late_hour: workEndLateHour,
  };
  if (timezone) {
    updatePayload.work_timezone = timezone;
  }

  const { error } = await supabase
    .from('user_tokens')
    .update(updatePayload)
    .eq('user_id', user.id);

  if (error) {
    console.error('[/api/user/settings] update error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ workStartHour, workEndHour, workEndLateHour, timezone: timezone ?? null });
}
