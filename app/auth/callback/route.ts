import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  if (code) {
    const supabase = createSupabaseServer();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.session) {
      // Store Google Calendar tokens when user signs in with Google + calendar scope.
      // Only include google_refresh_token in the upsert if Google actually returned one —
      // on repeat sign-ins Google omits the refresh token, and we must not overwrite
      // the existing stored one with null or the calendar connection will break.
      const { session } = data;
      if (session.provider_token && session.user) {
        const tokenPayload: Record<string, unknown> = {
          user_id: session.user.id,
          google_access_token: session.provider_token,
          google_token_expiry: session.expires_at
            ? new Date(session.expires_at * 1000).toISOString()
            : null,
        };
        if (session.provider_refresh_token) {
          tokenPayload.google_refresh_token = session.provider_refresh_token;
        }
        await supabase.from('user_tokens').upsert(tokenPayload, { onConflict: 'user_id' });
      }
      return NextResponse.redirect(`${appUrl}/dashboard`);
    }
    console.error('[/auth/callback] exchangeCodeForSession:', error);
  }

  return NextResponse.redirect(`${appUrl}/login`);
}
