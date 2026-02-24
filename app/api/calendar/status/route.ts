import { NextResponse } from 'next/server';
import { supabase, PLACEHOLDER_USER_ID } from '@/lib/supabase';

export async function GET() {
  const { data } = await supabase
    .from('user_tokens')
    .select('google_access_token')
    .eq('user_id', PLACEHOLDER_USER_ID)
    .single();

  return NextResponse.json({ connected: !!data?.google_access_token });
}
