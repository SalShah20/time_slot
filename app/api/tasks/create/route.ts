import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { getCalendarClient, fetchCalendarEventsForDay, getOrCreateTimeSlotCalendar, getPriorityColorId } from '@/lib/googleCalendar';
import { fallbackSchedule, localHourIn, localDateStrIn } from '@/lib/scheduleUtils';
import type { BusyInterval } from '@/lib/scheduleUtils';
import type { SupabaseClient } from '@supabase/supabase-js';
import { estimateDurationWithLLM } from '@/lib/estimateDuration';
import { fetchUserTimingHistory } from '@/lib/timingHistory';
import { computeSplitSessions } from '@/lib/splitSchedule';
import { guessTagWithLLM } from '@/lib/guessTag';

/** LLM-powered smart scheduler using GPT-4o-mini. Falls back to simple scheduling on any error. */
async function scheduleWithLLM(
  supabase: SupabaseClient,
  userId: string,
  task: {
    title: string;
    description?: string;
    estimatedMinutes: number;
    tag?: string;
    deadline?: string;
    priority?: string;
  },
  timezone: string,
): Promise<{ scheduled_start: string; scheduled_end: string; busyIntervals: BusyInterval[] }> {
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const twoDaysOut = new Date(todayStart);
  twoDaysOut.setDate(twoDaysOut.getDate() + 2);

  // Fetch existing schedule context
  const [{ data: existingTasks }, { data: calEvents }] = await Promise.all([
    supabase
      .from('tasks')
      .select('title, scheduled_start, scheduled_end, estimated_minutes, deadline, priority')
      .eq('user_id', userId)
      .not('status', 'in', '("completed","cancelled")')
      .gte('scheduled_start', todayStart.toISOString())
      .lt('scheduled_start', twoDaysOut.toISOString()),
    supabase
      .from('calendar_events')
      .select('title, start_time, end_time')
      .eq('user_id', userId)
      .gte('start_time', todayStart.toISOString())
      .lt('start_time', twoDaysOut.toISOString()),
  ]);

  // Build busy intervals for the fallback and overlap check
  const busyIntervals: BusyInterval[] = [
    ...(existingTasks ?? [])
      .filter((t) => t.scheduled_start)
      .map((t) => ({
        start: new Date(t.scheduled_start!),
        end: t.scheduled_end
          ? new Date(t.scheduled_end)
          : new Date(new Date(t.scheduled_start!).getTime() + t.estimated_minutes * 60_000),
      })),
    ...(calEvents ?? []).map((e) => ({
      start: new Date(e.start_time),
      end: new Date(e.end_time),
    })),
  ];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[scheduleWithLLM] OPENAI_API_KEY not set — using fallback');
    return { ...fallbackSchedule(busyIntervals, task.estimatedMinutes, task.deadline, timezone), busyIntervals };
  }

  const localTime = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(now);

  const prompt = `Schedule a task for a college student. Respond ONLY with valid JSON.

TASK: "${task.title}" | ${task.estimatedMinutes} min${task.deadline ? ` | due ${task.deadline}` : ''}${task.priority ? ` | ${task.priority} priority` : ''}
NOW: ${now.toISOString()} (${localTime})

EXISTING TASKS (today & tomorrow):
${JSON.stringify(existingTasks ?? [])}

CALENDAR EVENTS (today & tomorrow):
${JSON.stringify(calEvents ?? [])}

RULES:
1. Preferred window: 8 AM – 11 PM in the user's local timezone (${timezone}). If the day is fully packed and a deadline requires it, extending into the 11 PM – 3 AM window is acceptable as a last resort. Never schedule between 3 AM and 8 AM under any circumstances.
2. Task end time MUST be before or at deadline
3. If deadline is today, schedule ASAP — do not push to tomorrow
4. Avoid overlapping existing tasks and calendar events
5. Start at least 1 hour from NOW — never schedule something starting in the next 60 minutes
6. If there is no estimated duration, estimate based on the task name, description, similar tasks, and tags
7. If multiple valid slots, pick the earliest valid one
8. The earlier the deadline, the earlier the task should be scheduled
9. Always leave at least 15 minutes of buffer between tasks
10. If the deadline is 5 or more days away, do NOT schedule today — prefer tomorrow or later
11. For longer tasks with later due dates, it is ok to break them up into multiple sessions (ie. research papers, studying for a hard exam,...)

Respond ONLY with this JSON (no extra text):
{"scheduled_start":"ISO 8601 timestamp","reasoning":"one sentence"}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 150,
        temperature: 0.1,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const content = data.choices[0]?.message?.content;
    if (!content) throw new Error('Empty LLM response');

    const parsed = JSON.parse(content) as { scheduled_start: string; reasoning?: string };
    console.log('[scheduleWithLLM]', task.title, '→', parsed.scheduled_start, '|', parsed.reasoning ?? '');

    const scheduledStart = new Date(parsed.scheduled_start);
    if (isNaN(scheduledStart.getTime())) throw new Error('Invalid scheduled_start from LLM');

    let scheduledEnd = new Date(scheduledStart.getTime() + task.estimatedMinutes * 60_000);

    // Validate: reject times in the hard blackout (3 AM – 7 AM).
    // The midnight – 3 AM window is acceptable as a last resort so we allow it.
    const startH        = localHourIn(scheduledStart, timezone);
    const endH          = localHourIn(scheduledEnd, timezone);
    const crossDay      = new Intl.DateTimeFormat('sv', { timeZone: timezone }).format(scheduledEnd) !==
                          new Intl.DateTimeFormat('sv', { timeZone: timezone }).format(scheduledStart);
    const startBlackout = startH >= 3 && startH < 8;
    const endBlackout   = endH   >= 3 && endH   < 8;
    // End crosses into next-day daytime (8 AM+) — too far out.
    const endCrossesDay = crossDay && endH >= 8;
    if (startBlackout || endBlackout || endCrossesDay) {
      console.warn(`[scheduleWithLLM] LLM returned out-of-hours time ${scheduledStart.toISOString()} for "${task.title}" — falling back`);
      return { ...fallbackSchedule(busyIntervals, task.estimatedMinutes, task.deadline, timezone), busyIntervals };
    }

    // Safety: never schedule end past deadline
    if (task.deadline) {
      const dl = new Date(task.deadline);
      if (scheduledEnd > dl) {
        console.warn('[scheduleWithLLM] LLM end exceeds deadline — clamping to deadline');
        const adjustedStart = new Date(dl.getTime() - task.estimatedMinutes * 60_000);
        const finalStart    = adjustedStart > now ? adjustedStart : now;
        scheduledEnd        = new Date(finalStart.getTime() + task.estimatedMinutes * 60_000);
        return {
          scheduled_start: finalStart.toISOString(),
          scheduled_end:   scheduledEnd.toISOString(),
          busyIntervals,
        };
      }
    }

    // Validate: LLM result must not overlap any busy interval
    const hasOverlap = busyIntervals.some(
      (iv) => iv.start < scheduledEnd && iv.end > scheduledStart,
    );
    if (hasOverlap) {
      console.warn(
        '[scheduleWithLLM] LLM result overlaps existing schedule for "' + task.title + '" — falling back to deterministic scheduler',
      );
      return { ...fallbackSchedule(busyIntervals, task.estimatedMinutes, task.deadline, timezone), busyIntervals };
    }

    return {
      scheduled_start: scheduledStart.toISOString(),
      scheduled_end:   scheduledEnd.toISOString(),
      busyIntervals,
    };
  } catch (err) {
    console.error('[scheduleWithLLM] Error, falling back to simple scheduler:', err);
    return { ...fallbackSchedule(busyIntervals, task.estimatedMinutes, task.deadline, timezone), busyIntervals };
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const {
    title,
    description,
    tag,
    estimatedMinutes,
    priority,
    deadline,
    timezone = 'UTC',
    isFixed = false,
    fixedStart,
  } = await req.json() as {
    title: string;
    description?: string;
    tag?: string;
    estimatedMinutes: number;
    priority?: string;
    deadline?: string;
    timezone?: string;
    isFixed?: boolean;
    fixedStart?: string;
  };

  if (!title) {
    return NextResponse.json(
      { error: 'title is required' },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServer();

  // If no tag supplied, guess it from the title/description
  const finalTag = tag ?? await guessTagWithLLM(title, description);

  // If no duration supplied, ask the LLM to estimate it (using the user's own history to calibrate)
  const finalEstimatedMinutes = estimatedMinutes || await estimateDurationWithLLM(
    title, description, finalTag, priority,
    await fetchUserTimingHistory(supabase, user.id),
  );

  // ── Fixed-time fast path ────────────────────────────────────────────────────
  // Fixed tasks skip LLM scheduling, conflict checks, and splitting entirely.
  let finalScheduledStart: string;
  let finalScheduledEnd: string;
  let initialBusy: BusyInterval[] = [];

  if (isFixed && fixedStart) {
    finalScheduledStart = new Date(fixedStart).toISOString();
    finalScheduledEnd   = new Date(new Date(fixedStart).getTime() + finalEstimatedMinutes * 60_000).toISOString();
    console.log(`[/api/tasks/create] Fixed task "${title}" pinned to ${finalScheduledStart}`);
  } else {
    const result = await scheduleWithLLM(
      supabase,
      user.id,
      { title, description, estimatedMinutes: finalEstimatedMinutes, tag: finalTag ?? undefined, deadline, priority },
      timezone,
    );
    finalScheduledStart = result.scheduled_start;
    finalScheduledEnd   = result.scheduled_end;
    initialBusy         = result.busyIntervals;

    // If the task landed beyond tomorrow, fetch live GCal events for that day and
    // re-schedule if the slot conflicts with an event not yet in our DB cache.
    try {
      const scheduledDay = localDateStrIn(new Date(finalScheduledStart), timezone);
      const tomorrowDate = new Date();
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrowDay  = localDateStrIn(tomorrowDate, timezone);

      if (scheduledDay > tomorrowDay) {
        const calCheck = await getCalendarClient(supabase, user.id);
        if (calCheck) {
          const liveEvents = await fetchCalendarEventsForDay(calCheck, new Date(finalScheduledStart), timezone);
          const sStart = new Date(finalScheduledStart);
          const sEnd   = new Date(finalScheduledEnd);
          const hasOverlap = liveEvents.some((e) => e.start < sEnd && e.end > sStart);
          if (hasOverlap) {
            console.warn(`[/api/tasks/create] Slot on ${scheduledDay} conflicts with a live GCal event — rescheduling`);
            const augmented = [...initialBusy, ...liveEvents];
            const fb = fallbackSchedule(augmented, finalEstimatedMinutes, deadline, timezone);
            finalScheduledStart = fb.scheduled_start;
            finalScheduledEnd   = fb.scheduled_end;
          }
        }
      }
    } catch (err) {
      console.warn('[/api/tasks/create] Future-day GCal check failed (non-fatal):', err);
    }
  }

  const baseInsert: Record<string, unknown> = {
    user_id:           user.id,
    title,
    description:       description ?? null,
    tag:               finalTag ?? null,
    estimated_minutes: finalEstimatedMinutes,
    priority:          priority ?? null,
    deadline:          deadline ?? null,
    scheduled_start:   finalScheduledStart,
    status:            'pending',
  };
  if (isFixed) baseInsert.is_fixed = true;

  // ── Split trigger ───────────────────────────────────────────────────────────
  // Split any task > 60 min that has a future deadline — encourages breaks and
  // spreads long tasks across the available window instead of one marathon session.
  // Fixed tasks are never split.
  const shouldSplit =
    !isFixed &&
    deadline &&
    new Date(deadline) > new Date() &&
    finalEstimatedMinutes > 60;

  if (shouldSplit) {
    const sessions = await computeSplitSessions(
      { title, estimatedMinutes: finalEstimatedMinutes, deadline, priority, tag: finalTag },
      initialBusy,
      new Date(deadline),
      timezone,
    );

    if (sessions && sessions.length > 1) {
      // Insert session 1 first to get its ID
      const { data: s1, error: s1err } = await supabase
        .from('tasks')
        .insert({
          ...baseInsert,
          estimated_minutes: sessions[0].durationMinutes,
          scheduled_start:   sessions[0].scheduled_start,
          scheduled_end:     sessions[0].scheduled_end,
          session_number:    1,
          total_sessions:    sessions.length,
        })
        .select('*')
        .single();

      if (s1err) {
        console.error('[/api/tasks/create] split session 1 insert:', s1err);
        return NextResponse.json({ error: s1err.message }, { status: 500 });
      }

      // Insert sessions 2..N (children)
      const childRows = sessions.slice(1).map((s, i) => ({
        ...baseInsert,
        estimated_minutes: s.durationMinutes,
        scheduled_start:   s.scheduled_start,
        scheduled_end:     s.scheduled_end,
        session_number:    i + 2,
        total_sessions:    sessions.length,
        parent_task_id:    s1.id,
      }));

      const { data: children } = await supabase.from('tasks').insert(childRows).select('*');
      const allSessions = [s1, ...(children ?? [])];

      // Create GCal events for all sessions — non-fatal
      try {
        const calendar = await getCalendarClient(supabase, user.id);
        if (calendar) {
          const calId = await getOrCreateTimeSlotCalendar(supabase, user.id, calendar);
          await Promise.all(
            allSessions.map(async (sess) => {
              const suffix = ` (${(sess as Record<string, unknown>).session_number}/${sessions.length})`;
              try {
                const gcalEvent = await calendar.events.insert({
                  calendarId:  calId,
                  requestBody: {
                    summary:     title + suffix,
                    description: description ?? '',
                    start:       { dateTime: sess.scheduled_start! },
                    end:         { dateTime: sess.scheduled_end! },
                    colorId:     getPriorityColorId(priority),
                  },
                });
                const eventId = gcalEvent.data.id;
                if (eventId) {
                  await supabase.from('tasks').update({ google_event_id: eventId }).eq('id', sess.id);
                  (sess as Record<string, unknown>).google_event_id = eventId;
                }
              } catch (err) {
                console.warn(`[/api/tasks/create] GCal for split session:`, err);
              }
            }),
          );
        }
      } catch (err) {
        console.error('[/api/tasks/create] split GCal:', err);
      }

      return NextResponse.json({ tasks: allSessions });
    }
    // Split returned null (not enough blocks) → fall through to single insert
  }

  // ── Single-session insert ───────────────────────────────────────────────────
  let { data, error } = await supabase
    .from('tasks')
    .insert({ ...baseInsert, scheduled_end: finalScheduledEnd })
    .select('*')
    .single();

  // PGRST204 = column not found in schema cache (migration not yet run)
  if (error?.code === 'PGRST204') {
    const missingCol = error.message.match(/the '(\w+)' column/)?.[1];
    console.warn(`[/api/tasks/create] Column "${missingCol}" missing — run latest migration. Retrying without optional fields.`);
    ({ data, error } = await supabase
      .from('tasks')
      .insert(baseInsert)
      .select('id, user_id, title, estimated_minutes, deadline, scheduled_start, status, created_at, updated_at')
      .single());
    if (data) {
      (data as Record<string, unknown>).scheduled_end = finalScheduledEnd;
      (data as Record<string, unknown>).description   = description ?? null;
      (data as Record<string, unknown>).tag           = tag ?? null;
      (data as Record<string, unknown>).priority      = priority ?? null;
    }
  }

  if (error) {
    console.error('[/api/tasks/create]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Mirror to Google Calendar and store event ID — non-fatal if it fails
  try {
    const calendar = await getCalendarClient(supabase, user.id);
    if (calendar) {
      const calId = await getOrCreateTimeSlotCalendar(supabase, user.id, calendar);
      const gcalEvent = await calendar.events.insert({
        calendarId: calId,
        requestBody: {
          summary:     title,
          description: description ?? '',
          start:       { dateTime: finalScheduledStart },
          end:         { dateTime: finalScheduledEnd },
          colorId:     getPriorityColorId(priority),
        },
      });

      const eventId = gcalEvent.data.id;
      if (eventId && data?.id) {
        await supabase
          .from('tasks')
          .update({ google_event_id: eventId })
          .eq('id', data.id);
        (data as Record<string, unknown>).google_event_id = eventId;
      }
    }
  } catch (err) {
    console.error('[/api/tasks/create] Google Calendar event creation:', err);
  }

  return NextResponse.json({ tasks: [data] });
}
