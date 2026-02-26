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
      // Store Google Calendar tokens when user signs in with Google + calendar scope
      const { session } = data;
      if (session.provider_token && session.user) {
        await supabase.from('user_tokens').upsert(
          {
            user_id: session.user.id,
            google_access_token: session.provider_token,
            google_refresh_token: session.provider_refresh_token ?? null,
            google_token_expiry: session.expires_at
              ? new Date(session.expires_at * 1000).toISOString()
              : null,
          },
          { onConflict: 'user_id' }
        );
      }
      return NextResponse.redirect(`${appUrl}/`);
    }
    console.error('[/auth/callback] exchangeCodeForSession:', error);
  }

  return NextResponse.redirect(`${appUrl}/login`);
}
