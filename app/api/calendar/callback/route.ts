import { NextRequest, NextResponse } from 'next/server';
import { createOAuthClient, getCalendarClient } from '@/lib/googleCalendar';
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

    // Register GCal push notification channel (non-fatal)
    try {
      const gcal = await getCalendarClient(supabase, user.id);
      if (gcal) {
        const channelId = crypto.randomUUID();
        const expiresMs = Date.now() + 6 * 24 * 60 * 60 * 1000; // 6 days (< 7 day max)
        const watchRes = await gcal.events.watch({
          calendarId: 'primary',
          requestBody: {
            id:         channelId,
            type:       'web_hook',
            address:    `${appUrl}/api/calendar/webhook`,
            token:      user.id,
            expiration: String(expiresMs),
          },
        });
        await supabase.from('user_tokens').update({
          webhook_channel_id:  channelId,
          webhook_resource_id: watchRes.data.resourceId ?? null,
          webhook_expires_at:  new Date(Number(watchRes.data.expiration ?? expiresMs)).toISOString(),
        }).eq('user_id', user.id);
        console.log('[/api/calendar/callback] Webhook channel registered:', channelId);
      }
    } catch (err) {
      console.warn('[/api/calendar/callback] Webhook registration failed:', err);
      // Non-fatal — 5-min polling sync still works
    }

    return NextResponse.redirect(`${appUrl}/dashboard?calendar=connected`);
  } catch (err) {
    console.error('[/api/calendar/callback]', err);
    return NextResponse.redirect(`${appUrl}/dashboard?calendar=error`);
  }
}
