import { NextRequest, NextResponse } from 'next/server';
import { supabase, PLACEHOLDER_USER_ID } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const { pausedAt } = await req.json();

  if (!pausedAt) {
    return NextResponse.json({ error: 'pausedAt is required' }, { status: 400 });
  }

  // Fire-and-forget: if this fails, the next /sync will correct the DB state.
  const { error } = await supabase
    .from('active_timers')
    .update({ state: 'PAUSED', paused_at: pausedAt })
    .eq('user_id', PLACEHOLDER_USER_ID);

  if (error) {
    console.error('[/api/timer/pause]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
