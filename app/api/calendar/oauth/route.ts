import { NextResponse } from 'next/server';
import { createOAuthClient, CALENDAR_SCOPES } from '@/lib/googleCalendar';
import { getAuthUser } from '@/lib/supabase-server';

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const oauth2Client = createOAuthClient();

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: CALENDAR_SCOPES,
    prompt: 'consent', // Always show consent to ensure refresh_token is returned
  });

  return NextResponse.redirect(url);
}
