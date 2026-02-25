import { NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();
  const { data } = await supabase
    .from('user_tokens')
    .select('google_access_token')
    .eq('user_id', user.id)
    .single();

  return NextResponse.json({ connected: !!data?.google_access_token });
}
