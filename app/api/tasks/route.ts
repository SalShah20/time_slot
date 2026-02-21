import { NextResponse } from 'next/server';
import { supabase, PLACEHOLDER_USER_ID } from '@/lib/supabase';

export async function GET() {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', PLACEHOLDER_USER_ID)
    .not('status', 'in', '("completed","cancelled")')
    .order('scheduled_start', { ascending: true, nullsFirst: false });

  if (error) {
    console.error('[GET /api/tasks]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
