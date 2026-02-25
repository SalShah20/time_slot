import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { pausedAt } = await req.json();

  if (!pausedAt) {
    return NextResponse.json({ error: 'pausedAt is required' }, { status: 400 });
  }

  const supabase = createSupabaseServer();

  // Fire-and-forget: if this fails, the next /sync will correct the DB state.
  const { error } = await supabase
    .from('active_timers')
    .update({ state: 'PAUSED', paused_at: pausedAt })
    .eq('user_id', user.id);

  if (error) {
    console.error('[/api/timer/pause]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
