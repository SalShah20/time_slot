import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { getCalendarClient, fetchCalendarEventsForDay, getOrCreateTimeSlotCalendar, getTimeSlotCalendarId, getPriorityColorId } from '@/lib/googleCalendar';
import { fallbackSchedule, localHourIn, localDateStrIn, localTimeOnDay, detectTargetDay, detectPinnedTime } from '@/lib/scheduleUtils';
import type { BusyInterval, WorkHours } from '@/lib/scheduleUtils';
import { DEFAULT_WORK_HOURS } from '@/lib/scheduleUtils';
import { estimateDurationWithLLM } from '@/lib/estimateDuration';
import { computeSplitSessions } from '@/lib/splitSchedule';
import { guessTagWithLLM } from '@/lib/guessTag';
import type { SplitSession } from '@/lib/splitSchedule';
import { fetchWorkHours, formatHourForPrompt } from '@/lib/workHours';

interface TaskInput {
  title: string;
  description?: string;
  tag?: string;
  estimatedMinutes: number;
  priority?: string;
  deadline?: string;
  isFixed?: boolean;
  fixedStart?: string;
  reminderMinutes?: number;
}

interface ScheduledTask extends TaskInput {
  scheduled_start: string;
  scheduled_end: string;
}

interface BatchResult {
  task: ScheduledTask;
  sessions: SplitSession[]; // length 1 for non-split
}

function singleSession(t: ScheduledTask): SplitSession {
  return {
    scheduled_start: t.scheduled_start,
    scheduled_end:   t.scheduled_end,
    durationMinutes: t.estimatedMinutes,
  };
}

/**
 * Post-processes LLM-scheduled tasks: for any task whose slot misses its deadline,
 * attempts to split it. Rebuilds allBusy incrementally so each split uses up-to-date
 * availability (discarding the failed single-slot for that task).
 */
async function applyBatchSplitting(
  llmScheduled: ScheduledTask[],
  existingBusy: BusyInterval[],
  timezone: string,
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];
  const allBusy = [...existingBusy];
  const now     = new Date();

  for (const task of llmScheduled) {
    const deadline       = task.deadline ? new Date(task.deadline) : null;
    // Split any task > 60 min with a future deadline — spreads work across the window
    // Fixed tasks are never split.
    const shouldSplitTask = !task.isFixed && deadline && deadline > now && task.estimatedMinutes > 60;

    if (shouldSplitTask) {
      // Do NOT add the discarded LLM slot to allBusy — let computeSplitSessions use
      // the current allBusy which doesn't include this task's failed slot.
      const sessions = await computeSplitSessions(
        {
          title:            task.title,
          estimatedMinutes: task.estimatedMinutes,
          deadline:         task.deadline!,
          priority:         task.priority,
          tag:              task.tag,
        },
        allBusy,
        deadline,
        timezone,
      );

      if (sessions && sessions.length > 1) {
        for (const s of sessions) {
          allBusy.push({ start: new Date(s.scheduled_start), end: new Date(s.scheduled_end) });
        }
        results.push({ task, sessions });
        continue;
      }
    }

    // Non-split or split failed: use the LLM/fallback slot as-is
    results.push({ task, sessions: [singleSession(task)] });
    allBusy.push({ start: new Date(task.scheduled_start), end: new Date(task.scheduled_end) });
  }

  return results;
}

/** Lower score = more urgent = scheduled first. */
function urgencyScore(task: TaskInput): number {
  const hoursUntilDeadline = task.deadline
    ? (new Date(task.deadline).getTime() - Date.now()) / 3_600_000
    : Infinity;
  const priorityWeight = task.priority === 'high' ? 0.5 : task.priority === 'low' ? 1.5 : 1;
  return hoursUntilDeadline * priorityWeight;
}

/** Schedule all tasks together in one LLM call (fewer API calls than N individual calls). */
async function scheduleBatchWithLLM(
  tasks: TaskInput[],
  existingBusy: BusyInterval[],
  timezone: string,
  wh: WorkHours = DEFAULT_WORK_HOURS,
): Promise<ScheduledTask[]> {
  const now = new Date();
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.warn('[scheduleBatchWithLLM] OPENAI_API_KEY not set — using fallback for all tasks');
    return scheduleSequentialFallback(tasks, existingBusy, timezone, wh);
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
1. Preferred window: ${formatHourForPrompt(wh.workStartHour)} – ${formatHourForPrompt(wh.workEndHour)} in the user's local timezone (${timezone}). If the day is fully packed and a deadline requires it, extending up to ${formatHourForPrompt(wh.workEndLateHour)} is acceptable as a last resort. Never schedule between ${formatHourForPrompt(wh.workEndLateHour)} and ${formatHourForPrompt(wh.workStartHour)} under any circumstances.
2. Each task's end time MUST be before or at its deadline
3. Tasks due sooner should generally be scheduled sooner
4. No overlaps between tasks being scheduled, or with existing busy intervals
5. Start at least 1 hour from NOW — never schedule something starting in the next 60 minutes
6. Always leave at least 10 minutes of buffer between tasks
7. If multiple valid slots for a task, pick the earliest valid one
8. If the deadline is 5 or more days away, do NOT schedule today — prefer tomorrow or later
9. If a task mentions a specific day ("on Tuesday", "by Friday", "next Monday"), ALWAYS schedule on that exact day. Never schedule on an earlier day even if time is available.

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
        const fb = fallbackSchedule(allBusy, task.estimatedMinutes, task.deadline, timezone, wh);
        allBusy.push({ start: new Date(fb.scheduled_start), end: new Date(fb.scheduled_end) });
        results.push({ ...task, ...fb });
        continue;
      }

      const scheduledStart = new Date(slot.scheduled_start);
      if (isNaN(scheduledStart.getTime())) {
        console.warn(`[scheduleBatchWithLLM] Invalid start for task ${i} — falling back`);
        const fb = fallbackSchedule(allBusy, task.estimatedMinutes, task.deadline, timezone, wh);
        allBusy.push({ start: new Date(fb.scheduled_start), end: new Date(fb.scheduled_end) });
        results.push({ ...task, ...fb });
        continue;
      }

      const scheduledEnd = new Date(scheduledStart.getTime() + task.estimatedMinutes * 60_000);

      // Validate: reject times in the hard blackout (3 AM – 7 AM).
      // The midnight – 3 AM window is acceptable as a last resort so we allow it.
      const startH        = localHourIn(scheduledStart, timezone);
      const endH          = localHourIn(scheduledEnd, timezone);
      const crossDay      = new Intl.DateTimeFormat('sv', { timeZone: timezone }).format(scheduledEnd) !==
                            new Intl.DateTimeFormat('sv', { timeZone: timezone }).format(scheduledStart);
      const startBlackout = startH >= wh.workEndLateHour && startH < wh.workStartHour;
      const endBlackout   = endH   >= wh.workEndLateHour && endH   < wh.workStartHour;
      const endCrossesDay = crossDay && endH >= wh.workStartHour;
      if (startBlackout || endBlackout || endCrossesDay) {
        console.warn(`[scheduleBatchWithLLM] LLM returned out-of-hours time ${scheduledStart.toISOString()} for task ${i} ("${task.title}") — falling back`);
        const fb = fallbackSchedule(allBusy, task.estimatedMinutes, task.deadline, timezone, wh);
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
          const finalEnd = new Date(finalStart.getTime() + task.estimatedMinutes * 60_000);
          // Overlap check is still required even after deadline clamping
          const hasOverlapAfterClamp = allBusy.some((iv) => iv.start < finalEnd && iv.end > finalStart);
          if (hasOverlapAfterClamp) {
            console.warn(`[scheduleBatchWithLLM] Clamped slot overlaps for task ${i} ("${task.title}") — falling back`);
            const fb = fallbackSchedule(allBusy, task.estimatedMinutes, task.deadline, timezone, wh);
            allBusy.push({ start: new Date(fb.scheduled_start), end: new Date(fb.scheduled_end) });
            results.push({ ...task, ...fb });
          } else {
            results.push({
              ...task,
              scheduled_start: finalStart.toISOString(),
              scheduled_end:   finalEnd.toISOString(),
            });
            allBusy.push({ start: finalStart, end: finalEnd });
          }
          continue;
        }
      }

      // Validate: no overlap with any busy interval
      const hasOverlap = allBusy.some((iv) => iv.start < scheduledEnd && iv.end > scheduledStart);
      if (hasOverlap) {
        console.warn(`[scheduleBatchWithLLM] LLM result overlaps for task ${i} ("${task.title}") — falling back`);
        const fb = fallbackSchedule(allBusy, task.estimatedMinutes, task.deadline, timezone, wh);
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
    return scheduleSequentialFallback(tasks, existingBusy, timezone, wh);
  }
}

/** Fallback: schedule each task sequentially with the deterministic algorithm. */
function scheduleSequentialFallback(tasks: TaskInput[], initialBusy: BusyInterval[], timezone: string, wh: WorkHours = DEFAULT_WORK_HOURS): ScheduledTask[] {
  const busy = [...initialBusy];
  return tasks.map((task) => {
    const slot = fallbackSchedule(busy, task.estimatedMinutes, task.deadline, timezone, wh);
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
  const wh = await fetchWorkHours(supabase, user.id);

  try {
  // Fill in missing tags and durations via LLM (parallel to keep batch fast)
  // estimateDurationWithLLM now handles historical lookup + LLM calibration internally
  const tasksWithDurations = await Promise.all(
    tasks.map(async (t) => {
      const finalTag = t.tag ?? await guessTagWithLLM(t.title, t.description);
      const estimated = t.estimatedMinutes
        ? t.estimatedMinutes
        : (await estimateDurationWithLLM(t.title, t.description, finalTag, t.priority, supabase, user.id)).minutes;
      return { ...t, tag: finalTag ?? t.tag, estimatedMinutes: estimated };
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

  // Partition: fixed tasks and title-pinned tasks get their specified time; rest go to LLM
  const fixedScheduled: ScheduledTask[] = [];
  const autoTasks: (TaskInput & { tag?: string })[] = [];

  for (const t of tasksWithDurations) {
    if (t.isFixed && t.fixedStart) {
      // Explicitly fixed via UI
      fixedScheduled.push({
        ...t,
        scheduled_start: new Date(t.fixedStart).toISOString(),
        scheduled_end:   new Date(new Date(t.fixedStart).getTime() + t.estimatedMinutes * 60_000).toISOString(),
      });
    } else {
      // Check for pinned time in title (e.g. "at 4pm")
      const pinnedTime = detectPinnedTime(t.title);
      const targetDate = detectTargetDay(t.title, timezone);

      if (pinnedTime) {
        const baseDate = targetDate ?? new Date();
        const pinnedStart = localTimeOnDay(baseDate, pinnedTime.hour, pinnedTime.minute, timezone, 0);
        if (!targetDate && pinnedStart < new Date()) {
          pinnedStart.setTime(localTimeOnDay(new Date(), pinnedTime.hour, pinnedTime.minute, timezone, 1).getTime());
        }
        fixedScheduled.push({
          ...t,
          isFixed: true,
          scheduled_start: pinnedStart.toISOString(),
          scheduled_end:   new Date(pinnedStart.getTime() + t.estimatedMinutes * 60_000).toISOString(),
        });
      } else {
        autoTasks.push(t);
      }
    }
  }

  for (const ft of fixedScheduled) {
    existingBusy.push({ start: new Date(ft.scheduled_start), end: new Date(ft.scheduled_end) });
  }

  // Sort auto tasks by urgency so the most time-sensitive claim slots first
  const sortedTasks = [...autoTasks].sort((a, b) => urgencyScore(a) - urgencyScore(b));

  // Schedule auto tasks together (one LLM call); merge with pre-scheduled fixed tasks
  const autoScheduled = sortedTasks.length > 0
    ? await scheduleBatchWithLLM(sortedTasks, existingBusy, timezone, wh)
    : [];
  const scheduled = [...fixedScheduled, ...autoScheduled];
  // Retain reference to existingBusy for applyBatchSplitting below.

  // Post-scheduling: for any task landing beyond tomorrow, fetch live GCal events
  // for that day and re-schedule if the slot conflicts (DB only caches today+tomorrow).
  // Must run before the DB insert so the corrected times are persisted.
  try {
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowDay = localDateStrIn(tomorrowDate, timezone);

    const hasFutureDay = scheduled.some(
      (t) => localDateStrIn(new Date(t.scheduled_start), timezone) > tomorrowDay,
    );

    if (hasFutureDay) {
      const [calendarForCheck, tsCalIdForCheck] = await Promise.all([
        getCalendarClient(supabase, user.id),
        getTimeSlotCalendarId(supabase, user.id),
      ]);
      if (calendarForCheck) {
        // Per-day cache: avoids redundant API calls when multiple tasks land on the same day
        const dayEventsCache = new Map<string, Array<{ start: Date; end: Date }>>();
        // Tracks cumulative busy intervals (DB + already-placed batch tasks + fetched GCal days)
        const augmentedBusy = [...existingBusy];

        for (let i = 0; i < scheduled.length; i++) {
          const scheduledDay = localDateStrIn(new Date(scheduled[i].scheduled_start), timezone);

          if (scheduledDay > tomorrowDay) {
            // Lazily fetch and cache live GCal events for this day
            if (!dayEventsCache.has(scheduledDay)) {
              // Freebusy across all calendars (excluding TimeSlot's own calendar)
              const liveEvents = await fetchCalendarEventsForDay(
                calendarForCheck,
                new Date(scheduled[i].scheduled_start),
                timezone,
                tsCalIdForCheck,
              );
              dayEventsCache.set(scheduledDay, liveEvents);
              augmentedBusy.push(...liveEvents);
            }

            // Check if this task's slot overlaps any live GCal event on this day
            const taskStart = new Date(scheduled[i].scheduled_start);
            const taskEnd   = new Date(scheduled[i].scheduled_end);
            const dayEvents = dayEventsCache.get(scheduledDay)!;
            const hasOverlap = dayEvents.some((e) => e.start < taskEnd && e.end > taskStart);

            if (hasOverlap) {
              console.warn(
                `[batch-create] "${scheduled[i].title}" conflicts with a live GCal event on ${scheduledDay} — rescheduling`,
              );
              const fb = fallbackSchedule(
                augmentedBusy,
                scheduled[i].estimatedMinutes,
                scheduled[i].deadline,
                timezone,
                wh,
              );
              scheduled[i] = { ...scheduled[i], ...fb };
            }
          }

          // Track this task's final slot so subsequent tasks avoid it
          augmentedBusy.push({
            start: new Date(scheduled[i].scheduled_start),
            end:   new Date(scheduled[i].scheduled_end),
          });
        }
      }
    }
  } catch (err) {
    console.warn('[batch-create] Future-day GCal check failed (non-fatal):', err);
  }

  // Post-process: attempt splitting for tasks whose slots miss their deadlines
  const results = await applyBatchSplitting(scheduled, existingBusy, timezone);

  // ── Insert session-1 rows (one per task) ───────────────────────────────────
  const session1Rows = results.map((r) => ({
    user_id:           user.id,
    title:             r.task.title,
    description:       r.task.description ?? null,
    tag:               r.task.tag ?? null,
    estimated_minutes: r.sessions[0].durationMinutes,
    priority:          r.task.priority ?? null,
    deadline:          r.task.deadline ?? null,
    scheduled_start:   r.sessions[0].scheduled_start,
    scheduled_end:     r.sessions[0].scheduled_end,
    status:            'pending',
    session_number:    1,
    total_sessions:    r.sessions.length,
    is_fixed:          !!r.task.isFixed,
    reminder_minutes:  r.task.reminderMinutes ?? null,
  }));

  const { data: insertedSession1, error: s1Error } = await supabase
    .from('tasks')
    .insert(session1Rows)
    .select('*');

  if (s1Error) {
    console.error('[/api/tasks/batch-create]', s1Error);
    return NextResponse.json({ error: s1Error.message }, { status: 500 });
  }

  // ── Insert child rows for split tasks (sessions 2..N) ──────────────────────
  const childRows: Record<string, unknown>[] = [];
  for (let i = 0; i < results.length; i++) {
    const r        = results[i];
    const parentId = insertedSession1![i].id;
    for (let k = 1; k < r.sessions.length; k++) {
      childRows.push({
        user_id:           user.id,
        title:             r.task.title,
        description:       r.task.description ?? null,
        tag:               r.task.tag ?? null,
        estimated_minutes: r.sessions[k].durationMinutes,
        priority:          r.task.priority ?? null,
        deadline:          r.task.deadline ?? null,
        scheduled_start:   r.sessions[k].scheduled_start,
        scheduled_end:     r.sessions[k].scheduled_end,
        status:            'pending',
        session_number:    k + 1,
        total_sessions:    r.sessions.length,
        parent_task_id:    parentId,
        reminder_minutes:  r.task.reminderMinutes ?? null,
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let insertedChildren: any[] = [];
  if (childRows.length > 0) {
    const { data: children, error: childError } = await supabase
      .from('tasks')
      .insert(childRows)
      .select('*');
    if (childError) {
      console.error('[/api/tasks/batch-create] child session insert:', childError);
      // Non-fatal: parent tasks are already inserted; proceed without children
    } else {
      insertedChildren = children ?? [];
    }
  }

  const allInserted = [...(insertedSession1 ?? []), ...insertedChildren];

  // ── Create GCal events in parallel — non-fatal ────────────────────────────
  try {
    const calendar = await getCalendarClient(supabase, user.id);
    if (calendar && allInserted.length > 0) {
      const calId = await getOrCreateTimeSlotCalendar(supabase, user.id, calendar);
      // Build a flat list mapping each inserted row to its original task + session info
      interface GCalTarget {
        taskRow:        Record<string, unknown>;
        originalTask:   ScheduledTask;
        sessionNumber:  number;
        totalSessions:  number;
      }
      const gcalTargets: GCalTarget[] = [];
      let childIdx = 0;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        gcalTargets.push({
          taskRow:       insertedSession1![i] as Record<string, unknown>,
          originalTask:  r.task,
          sessionNumber: 1,
          totalSessions: r.sessions.length,
        });
        for (let k = 1; k < r.sessions.length; k++) {
          gcalTargets.push({
            taskRow:       insertedChildren[childIdx] as Record<string, unknown>,
            originalTask:  r.task,
            sessionNumber: k + 1,
            totalSessions: r.sessions.length,
          });
          childIdx++;
        }
      }

      await Promise.all(
        gcalTargets.map(async ({ taskRow, originalTask, sessionNumber, totalSessions }) => {
          if (!taskRow) return;
          const suffix = totalSessions > 1 ? ` (${sessionNumber}/${totalSessions})` : '';
          try {
            const rm = originalTask.reminderMinutes;
            const gcalReminders = rm != null && rm > 0
              ? { useDefault: false, overrides: [{ method: 'popup' as const, minutes: rm }] }
              : rm === 0
                ? { useDefault: false, overrides: [] }
                : undefined;
            const gcalEvent = await calendar.events.insert({
              calendarId:  calId,
              requestBody: {
                summary:     (taskRow.title as string) + suffix,
                description: (taskRow.description as string) ?? '',
                start:       { dateTime: taskRow.scheduled_start as string },
                end:         { dateTime: taskRow.scheduled_end as string },
                colorId:     getPriorityColorId(originalTask.priority),
                ...(gcalReminders ? { reminders: gcalReminders } : {}),
              },
            });
            const eventId = gcalEvent.data.id;
            if (eventId) {
              await supabase.from('tasks').update({ google_event_id: eventId }).eq('id', taskRow.id);
              taskRow.google_event_id = eventId;
            }
          } catch (err) {
            console.warn(
              `[/api/tasks/batch-create] GCal event creation failed for "${taskRow.title as string}${suffix}":`,
              err,
            );
          }
        }),
      );
    }
  } catch (err) {
    console.error('[/api/tasks/batch-create] GCal batch creation:', err);
  }

  return NextResponse.json({ tasks: allInserted });
  } catch (err) {
    console.error('[/api/tasks/batch-create] Unhandled error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
