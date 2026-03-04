import { NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();
  const { data, error } = await supabase
    .from('tasks')
    .select('status')
    .eq('user_id', user.id)
    .neq('status', 'cancelled')
    .is('parent_task_id', null);

  if (error) {
    console.error('[GET /api/tasks/stats]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total     = data.length;
  const upcoming  = data.filter((t) => t.status === 'pending' || t.status === 'in_progress').length;
  const completed = data.filter((t) => t.status === 'completed').length;

  return NextResponse.json({ total, upcoming, completed });
}
