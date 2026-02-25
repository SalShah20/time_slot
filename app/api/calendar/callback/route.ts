import { NextRequest, NextResponse } from 'next/server';
import { createOAuthClient } from '@/lib/googleCalendar';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');

  if (error || !code) {
    console.error('[/api/calendar/callback] OAuth error:', error);
    return NextResponse.redirect(`${appUrl}?calendar=error`);
  }

  const user = await getAuthUser();
  if (!user) return NextResponse.redirect(`${appUrl}/login`);

  try {
    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    const supabase = createSupabaseServer();

    // Store tokens — upsert so reconnecting overwrites old tokens
    const { error: dbError } = await supabase
      .from('user_tokens')
      .upsert({
        user_id: user.id,
        google_access_token: tokens.access_token ?? null,
        google_refresh_token: tokens.refresh_token ?? null,
        google_token_expiry: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
      });

    if (dbError) {
      console.error('[/api/calendar/callback] upsert tokens:', dbError);
      return NextResponse.redirect(`${appUrl}?calendar=error`);
    }

    // Trigger an immediate sync in the background (fire-and-forget)
    fetch(`${appUrl}/api/calendar/sync`, { method: 'POST' }).catch(() => null);

    return NextResponse.redirect(`${appUrl}?calendar=connected`);
  } catch (err) {
    console.error('[/api/calendar/callback]', err);
    return NextResponse.redirect(`${appUrl}?calendar=error`);
  }
}
