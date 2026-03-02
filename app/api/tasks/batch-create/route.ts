import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { getCalendarClient } from '@/lib/googleCalendar';
import { getTagColor } from '@/lib/tagColors';
import { fallbackSchedule, localHourIn } from '@/lib/scheduleUtils';
import type { BusyInterval } from '@/lib/scheduleUtils';
import { estimateDurationWithLLM } from '@/lib/estimateDuration';

interface TaskInput {
  title: string;
  description?: string;
  tag?: string;
  estimatedMinutes: number;
  priority?: string;
  deadline?: string;
}

interface ScheduledTask extends TaskInput {
  scheduled_start: string;
  scheduled_end: string;
}

/** Schedule all tasks together in one LLM call (fewer API calls than N individual calls). */
async function scheduleBatchWithLLM(
  tasks: TaskInput[],
  existingBusy: BusyInterval[],
  timezone: string,
): Promise<ScheduledTask[]> {
  const now = new Date();
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.warn('[scheduleBatchWithLLM] OPENAI_API_KEY not set — using fallback for all tasks');
    return scheduleSequentialFallback(tasks, existingBusy, timezone);
  }

  const localTime = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(now);

  const taskList = tasks.map((t, i) =>
    `${i}: "${t.title}" | ${t.estimatedMinutes} min${t.deadline ? ` | due ${t.deadline}` : ''}${t.priority ? ` | ${t.priority} priority` : ''}`
  ).join('\n');

  const busyForPrompt = existingBusy.map((b) => ({
    start: b.start.toISOString(),
    end: b.end.toISOString(),
  }));

  const prompt = `Schedule these tasks for a college student. Return a JSON array with one entry per task index.

TASKS TO SCHEDULE:
${taskList}

NOW: ${now.toISOString()} (${localTime})

EXISTING BUSY INTERVALS (tasks + calendar events):
${JSON.stringify(busyForPrompt)}

RULES:
1. Schedule ONLY between 7am and 11pm in the user's local timezone (${timezone}). Never use the 12am–7am window under any circumstances. If today is too full, schedule for tomorrow morning.
2. Each task's end time MUST be before or at its deadline
3. Tasks due sooner should generally be scheduled sooner
4. No overlaps between tasks being scheduled, or with existing busy intervals
5. Start at least 10 minutes from NOW
6. If multiple valid slots for a task, pick the earliest one

Respond ONLY with a JSON array (no extra text):
[{"index":0,"scheduled_start":"ISO 8601 timestamp"},{"index":1,"scheduled_start":"ISO 8601 timestamp"}]`;

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
        max_tokens: 500,
        temperature: 0.1,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const content = data.choices[0]?.message?.content;
    if (!content) throw new Error('Empty LLM response');

    // LLM may return { "schedule": [...] } or just [...]
    const parsed = JSON.parse(content) as Record<string, unknown> | unknown[];
    const scheduleArray: Array<{ index: number; scheduled_start: string }> = Array.isArray(parsed)
      ? parsed as Array<{ index: number; scheduled_start: string }>
      : (parsed as Record<string, unknown[]>).schedule as Array<{ index: number; scheduled_start: string }>
        ?? Object.values(parsed as Record<string, unknown>)[0] as Array<{ index: number; scheduled_start: string }>;

    if (!Array.isArray(scheduleArray)) throw new Error('LLM did not return array');

    // Build result, validating each slot and falling back per-task if needed
    const allBusy = [...existingBusy];
    const results: ScheduledTask[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const slot = scheduleArray.find((s) => s.index === i);

      if (!slot?.scheduled_start) {
        console.warn(`[scheduleBatchWithLLM] No slot returned for task ${i} ("${task.title}") — falling back`);
        const fb = fallbackSchedule(allBusy, task.estimatedMinutes, task.deadline, timezone);
        allBusy.push({ start: new Date(fb.scheduled_start), end: new Date(fb.scheduled_end) });
        results.push({ ...task, ...fb });
        continue;
      }

      const scheduledStart = new Date(slot.scheduled_start);
      if (isNaN(scheduledStart.getTime())) {
        console.warn(`[scheduleBatchWithLLM] Invalid start for task ${i} — falling back`);
        const fb = fallbackSchedule(allBusy, task.estimatedMinutes, task.deadline, timezone);
        allBusy.push({ start: new Date(fb.scheduled_start), end: new Date(fb.scheduled_end) });
        results.push({ ...task, ...fb });
        continue;
      }

      let scheduledEnd = new Date(scheduledStart.getTime() + task.estimatedMinutes * 60_000);

      // Validate: LLM result must be within work hours (7 AM – 11 PM in user's timezone)
      const startH   = localHourIn(scheduledStart, timezone);
      const endH     = localHourIn(scheduledEnd,   timezone);
      const crossDay = new Intl.DateTimeFormat('sv', { timeZone: timezone }).format(scheduledEnd) !==
                       new Intl.DateTimeFormat('sv', { timeZone: timezone }).format(scheduledStart);
      if (startH < 7 || endH > 23 || crossDay) {
        console.warn(`[scheduleBatchWithLLM] LLM returned out-of-hours time ${scheduledStart.toISOString()} for task ${i} ("${task.title}") — falling back`);
        const fb = fallbackSchedule(allBusy, task.estimatedMinutes, task.deadline, timezone);
        allBusy.push({ start: new Date(fb.scheduled_start), end: new Date(fb.scheduled_end) });
        results.push({ ...task, ...fb });
        continue;
      }

      // Clamp to deadline
      if (task.deadline) {
        const dl = new Date(task.deadline);
        if (scheduledEnd > dl) {
          const adjustedStart = new Date(dl.getTime() - task.estimatedMinutes * 60_000);
          const finalStart = adjustedStart > now ? adjustedStart : now;
          scheduledEnd = new Date(finalStart.getTime() + task.estimatedMinutes * 60_000);
          results.push({
            ...task,
            scheduled_start: finalStart.toISOString(),
            scheduled_end: scheduledEnd.toISOString(),
          });
          allBusy.push({ start: finalStart, end: scheduledEnd });
          continue;
        }
      }

      // Validate: no overlap with any busy interval
      const hasOverlap = allBusy.some((iv) => iv.start < scheduledEnd && iv.end > scheduledStart);
      if (hasOverlap) {
        console.warn(`[scheduleBatchWithLLM] LLM result overlaps for task ${i} ("${task.title}") — falling back`);
        const fb = fallbackSchedule(allBusy, task.estimatedMinutes, task.deadline, timezone);
        allBusy.push({ start: new Date(fb.scheduled_start), end: new Date(fb.scheduled_end) });
        results.push({ ...task, ...fb });
        continue;
      }

      console.log(`[scheduleBatchWithLLM] "${task.title}" → ${scheduledStart.toISOString()}`);
      allBusy.push({ start: scheduledStart, end: scheduledEnd });
      results.push({
        ...task,
        scheduled_start: scheduledStart.toISOString(),
        scheduled_end:   scheduledEnd.toISOString(),
      });
    }

    return results;
  } catch (err) {
    console.error('[scheduleBatchWithLLM] LLM error, falling back for all tasks:', err);
    return scheduleSequentialFallback(tasks, existingBusy, timezone);
  }
}

/** Fallback: schedule each task sequentially with the deterministic algorithm. */
function scheduleSequentialFallback(tasks: TaskInput[], initialBusy: BusyInterval[], timezone: string): ScheduledTask[] {
  const busy = [...initialBusy];
  return tasks.map((task) => {
    const slot = fallbackSchedule(busy, task.estimatedMinutes, task.deadline, timezone);
    busy.push({ start: new Date(slot.scheduled_start), end: new Date(slot.scheduled_end) });
    return { ...task, ...slot };
  });
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { tasks: TaskInput[]; timezone?: string };
  try {
    body = await req.json() as { tasks: TaskInput[]; timezone?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { tasks, timezone = 'UTC' } = body;

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return NextResponse.json({ error: 'tasks array is required' }, { status: 400 });
  }
  for (const t of tasks) {
    if (!t.title) {
      return NextResponse.json({ error: 'Each task requires a title' }, { status: 400 });
    }
  }

  const supabase = createSupabaseServer();

  try {
  // Fill in missing durations via LLM (parallel to keep batch fast)
  const tasksWithDurations = await Promise.all(
    tasks.map(async (t) => {
      if (t.estimatedMinutes) return t;
      const estimated = await estimateDurationWithLLM(t.title, t.description, t.tag, t.priority);
      return { ...t, estimatedMinutes: estimated };
    }),
  );
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const twoDaysOut = new Date(todayStart);
  twoDaysOut.setDate(twoDaysOut.getDate() + 2);

  // Fetch existing busy intervals once for the whole batch
  const [{ data: existingTasks }, { data: calEvents }] = await Promise.all([
    supabase
      .from('tasks')
      .select('scheduled_start, scheduled_end, estimated_minutes')
      .eq('user_id', user.id)
      .not('status', 'in', '("completed","cancelled")')
      .gte('scheduled_start', todayStart.toISOString())
      .lt('scheduled_start', twoDaysOut.toISOString()),
    supabase
      .from('calendar_events')
      .select('start_time, end_time')
      .eq('user_id', user.id)
      .gte('start_time', todayStart.toISOString())
      .lt('start_time', twoDaysOut.toISOString()),
  ]);

  const existingBusy: BusyInterval[] = [
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

  // Schedule all tasks together (one LLM call)
  const scheduled = await scheduleBatchWithLLM(tasksWithDurations, existingBusy, timezone);

  // Bulk insert all tasks
  const rows = scheduled.map((t) => ({
    user_id:           user.id,
    title:             t.title,
    description:       t.description ?? null,
    tag:               t.tag ?? null,
    estimated_minutes: t.estimatedMinutes,
    priority:          t.priority ?? null,
    deadline:          t.deadline ?? null,
    scheduled_start:   t.scheduled_start,
    scheduled_end:     t.scheduled_end,
    status:            'pending',
  }));

  const { data: insertedTasks, error: insertError } = await supabase
    .from('tasks')
    .insert(rows)
    .select('*');

  if (insertError) {
    console.error('[/api/tasks/batch-create]', insertError);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Create GCal events in parallel — non-fatal
  try {
    const calendar = await getCalendarClient(supabase, user.id);
    if (calendar && insertedTasks) {
      const gcalPromises = insertedTasks.map(async (task, i) => {
        const s = scheduled[i];
        const tagColor = getTagColor(s.tag);
        try {
          const gcalEvent = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: {
              summary:     task.title,
              description: task.description ?? '',
              start:       { dateTime: task.scheduled_start },
              end:         { dateTime: task.scheduled_end },
              colorId:     tagColor.gcalColorId,
            },
          });
          const eventId = gcalEvent.data.id;
          if (eventId) {
            await supabase
              .from('tasks')
              .update({ google_event_id: eventId })
              .eq('id', task.id);
            (task as Record<string, unknown>).google_event_id = eventId;
          }
        } catch (err) {
          console.warn(`[/api/tasks/batch-create] GCal event creation failed for "${task.title}":`, err);
        }
      });
      await Promise.all(gcalPromises);
    }
  } catch (err) {
    console.error('[/api/tasks/batch-create] GCal batch creation:', err);
  }

  return NextResponse.json({ tasks: insertedTasks });
  } catch (err) {
    console.error('[/api/tasks/batch-create] Unhandled error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
