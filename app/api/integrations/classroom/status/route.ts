import { NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';

/** GET — check if user has Google Classroom scope authorized. */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();
  const { data } = await supabase
    .from('user_tokens')
    .select('google_access_token, classroom_connected, classroom_last_synced')
    .eq('user_id', user.id)
    .single();

  const row = data as Record<string, unknown> | null;
  if (!row?.google_access_token) {
    return NextResponse.json({ connected: false, reason: 'no_google' });
  }

  // If already marked connected, trust that
  if (row.classroom_connected) {
    return NextResponse.json({
      connected: true,
      lastSynced: row.classroom_last_synced ?? null,
    });
  }

  // Test Classroom API access with the existing Google token
  try {
    const testRes = await fetch(
      'https://classroom.googleapis.com/v1/courses?pageSize=1',
      { headers: { Authorization: `Bearer ${row.google_access_token as string}` } },
    );

    if (testRes.ok) {
      // Mark as connected so future checks are instant
      await supabase
        .from('user_tokens')
        .update({ classroom_connected: true })
        .eq('user_id', user.id);
      return NextResponse.json({ connected: true, lastSynced: null });
    }

    return NextResponse.json({ connected: false, reason: 'scope_missing' });
  } catch {
    return NextResponse.json({ connected: false, reason: 'error' });
  }
}
