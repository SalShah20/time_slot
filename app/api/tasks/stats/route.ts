import { NextResponse } from 'next/server';
import { supabase, PLACEHOLDER_USER_ID } from '@/lib/supabase';

export async function GET() {
  const { data, error } = await supabase
    .from('tasks')
    .select('status')
    .eq('user_id', PLACEHOLDER_USER_ID)
    .neq('status', 'cancelled');

  if (error) {
    console.error('[GET /api/tasks/stats]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total     = data.length;
  const upcoming  = data.filter((t) => t.status === 'pending' || t.status === 'in_progress').length;
  const completed = data.filter((t) => t.status === 'completed').length;

  return NextResponse.json({ total, upcoming, completed });
}
