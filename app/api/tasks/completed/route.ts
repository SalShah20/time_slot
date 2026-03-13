import { NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, tag, priority, updated_at, actual_duration, estimated_minutes')
    .eq('user_id', user.id)
    .eq('status', 'completed')
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[GET /api/tasks/completed]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
