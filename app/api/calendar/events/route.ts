import { NextResponse } from 'next/server';
import { supabase, PLACEHOLDER_USER_ID } from '@/lib/supabase';

export async function GET() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

  const { data, error } = await supabase
    .from('calendar_events')
    .select('id, google_event_id, title, start_time, end_time, is_busy')
    .eq('user_id', PLACEHOLDER_USER_ID)
    .gte('start_time', startOfDay)
    .lt('start_time', endOfDay)
    .order('start_time', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
