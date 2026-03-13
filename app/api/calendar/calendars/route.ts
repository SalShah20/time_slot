import { NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { getCalendarClient, getTimeSlotCalendarId } from '@/lib/googleCalendar';

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();
  const [calendar, tsCalId] = await Promise.all([
    getCalendarClient(supabase, user.id),
    getTimeSlotCalendarId(supabase, user.id),
  ]);

  if (!calendar) {
    return NextResponse.json({ error: 'Not connected' }, { status: 401 });
  }

  try {
    const listRes = await calendar.calendarList.list();
    const cals = (listRes.data.items ?? [])
      .filter((c) => c.id && c.id !== tsCalId)
      .map((c) => ({
        id: c.id!,
        summary: c.summary ?? c.id!,
        primary: c.primary ?? false,
      }));

    return NextResponse.json({ calendars: cals });
  } catch (err) {
    console.error('[/api/calendar/calendars] error:', err);
    return NextResponse.json({ error: 'Failed to list calendars' }, { status: 500 });
  }
}
