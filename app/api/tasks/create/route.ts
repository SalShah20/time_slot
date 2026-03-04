import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { getCalendarClient } from '@/lib/googleCalendar';
import { getTagColor } from '@/lib/tagColors';
import { fallbackSchedule, localHourIn } from '@/lib/scheduleUtils';
import type { BusyInterval } from '@/lib/scheduleUtils';
import type { SupabaseClient } from '@supabase/supabase-js';
import { estimateDurationWithLLM } from '@/lib/estimateDuration';
import { fetchUserTimingHistory } from '@/lib/timingHistory';

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
): Promise<{ scheduled_start: string; scheduled_end: string }> {
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
    return fallbackSchedule(busyIntervals, task.estimatedMinutes, task.deadline, timezone);
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
1. Preferred window: 7 AM – 11 PM in the user's local timezone (${timezone}). If the day is fully packed and a deadline requires it, extending into the 11 PM – 3 AM window is acceptable as a last resort. Never schedule between 3 AM and 7 AM under any circumstances.
2. Task end time MUST be before or at deadline
3. If deadline is today, schedule ASAP — do not push to tomorrow
4. Avoid overlapping existing tasks and calendar events
5. Start at least 10 minutes from NOW to give the user time to prepare
6. If there is no estimated duration, estimate based on the task name, description, similar tasks, and tags
7. If multiple valid slots, pick the earliest one
8. The earlier the deadline, the earlier the task should be scheduled.
9. Give the user at least 15 minutes breaks in between tasks to avoid burnout
10. For longer tasks with later due dates, it is ok to break them up into multiple sessions (ie. research papers, studying for a hard exam,...)

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
    const startBlackout = startH >= 3 && startH < 7;
    const endBlackout   = endH   >= 3 && endH   < 7;
    // End crosses into next-day daytime (7 AM+) — too far out.
    const endCrossesDay = crossDay && endH >= 7;
    if (startBlackout || endBlackout || endCrossesDay) {
      console.warn(`[scheduleWithLLM] LLM returned out-of-hours time ${scheduledStart.toISOString()} for "${task.title}" — falling back`);
      return fallbackSchedule(busyIntervals, task.estimatedMinutes, task.deadline, timezone);
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
      return fallbackSchedule(busyIntervals, task.estimatedMinutes, task.deadline, timezone);
    }

    return {
      scheduled_start: scheduledStart.toISOString(),
      scheduled_end:   scheduledEnd.toISOString(),
    };
  } catch (err) {
    console.error('[scheduleWithLLM] Error, falling back to simple scheduler:', err);
    return fallbackSchedule(busyIntervals, task.estimatedMinutes, task.deadline, timezone);
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
  } = await req.json() as {
    title: string;
    description?: string;
    tag?: string;
    estimatedMinutes: number;
    priority?: string;
    deadline?: string;
    timezone?: string;
  };

  if (!title) {
    return NextResponse.json(
      { error: 'title is required' },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServer();

  // If no duration supplied, ask the LLM to estimate it (using the user's own history to calibrate)
  const finalEstimatedMinutes = estimatedMinutes || await estimateDurationWithLLM(
    title, description, tag, priority,
    await fetchUserTimingHistory(supabase, user.id),
  );

  const { scheduled_start: scheduledStart, scheduled_end: scheduledEnd } = await scheduleWithLLM(
    supabase,
    user.id,
    { title, description, estimatedMinutes: finalEstimatedMinutes, tag, deadline, priority },
    timezone,
  );

  const baseInsert = {
    user_id:           user.id,
    title,
    description:       description ?? null,
    tag:               tag ?? null,
    estimated_minutes: finalEstimatedMinutes,
    priority:          priority ?? null,
    deadline:          deadline ?? null,
    scheduled_start:   scheduledStart,
    status:            'pending',
  };

  let { data, error } = await supabase
    .from('tasks')
    .insert({ ...baseInsert, scheduled_end: scheduledEnd })
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
      (data as Record<string, unknown>).scheduled_end = scheduledEnd;
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
      const tagColor = getTagColor(tag);
      const gcalEvent = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary:     title,
          description: description ?? '',
          start:       { dateTime: scheduledStart },
          end:         { dateTime: scheduledEnd },
          colorId:     tagColor.gcalColorId,
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

  return NextResponse.json(data);
}
