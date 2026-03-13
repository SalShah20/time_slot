import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { getCalendarClient, getTimeSlotCalendarId } from '@/lib/googleCalendar';

interface CalendarFilterRow {
  google_calendar_id: string;
  is_included: boolean;
}

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
    // Fetch Google calendar list + existing filter rows in parallel
    const [calListRes, filtersRes] = await Promise.all([
      calendar.calendarList.list(),
      supabase
        .from('calendar_filters')
        .select('google_calendar_id, is_included')
        .eq('user_id', user.id),
    ]);

    const filterMap = new Map<string, boolean>();
    for (const row of (filtersRes.data ?? []) as CalendarFilterRow[]) {
      filterMap.set(row.google_calendar_id, row.is_included);
    }

    const calendars = (calListRes.data.items ?? [])
      .filter((c) => c.id && c.id !== tsCalId)
      .map((c) => ({
        id: c.id!,
        name: c.summary ?? c.id!,
        color: c.backgroundColor ?? null,
        isPrimary: c.primary ?? false,
        // Default to included if no filter row exists (opt-out model)
        isIncluded: filterMap.has(c.id!) ? filterMap.get(c.id!)! : true,
      }));

    return NextResponse.json({ calendars });
  } catch (err) {
    console.error('[/api/calendar/filter] error:', err);
    return NextResponse.json({ error: 'Failed to list calendars' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json() as {
    calendarId?: string;
    calendarName?: string;
    isIncluded?: boolean;
  };

  if (!body.calendarId || typeof body.isIncluded !== 'boolean') {
    return NextResponse.json({ error: 'calendarId and isIncluded are required' }, { status: 400 });
  }

  const supabase = createSupabaseServer();

  const { error } = await supabase
    .from('calendar_filters')
    .upsert(
      {
        user_id: user.id,
        google_calendar_id: body.calendarId,
        calendar_name: body.calendarName ?? body.calendarId,
        is_included: body.isIncluded,
      },
      { onConflict: 'user_id,google_calendar_id' },
    );

  if (error) {
    console.error('[/api/calendar/filter] upsert error:', error);
    return NextResponse.json({ error: 'Failed to save filter' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
