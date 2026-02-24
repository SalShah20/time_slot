import { NextResponse } from 'next/server';
import { createOAuthClient, CALENDAR_SCOPES } from '@/lib/googleCalendar';

export async function GET() {
  const oauth2Client = createOAuthClient();

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: CALENDAR_SCOPES,
    prompt: 'consent', // Always show consent to ensure refresh_token is returned
  });

  return NextResponse.redirect(url);
}
