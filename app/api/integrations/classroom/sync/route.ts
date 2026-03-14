import { NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { fetchUpcomingClassroomAssignments } from '@/lib/googleClassroom';
import type { ClassroomAssignment } from '@/lib/googleClassroom';
import { fallbackSchedule } from '@/lib/scheduleUtils';
import type { BusyInterval } from '@/lib/scheduleUtils';
import { fetchWorkHours, fetchUserTimezone } from '@/lib/workHours';
import { getCalendarClient, getOrCreateTimeSlotCalendar, getPriorityColorId } from '@/lib/googleCalendar';
import { getTagColor } from '@/lib/tagColors';

/**
 * Estimate duration for a batch of assignments via GPT-4o-mini.
 * Falls back to 60 min per assignment on any failure.
 */
async function estimateAssignmentDurations(
  assignments: ClassroomAssignment[],
): Promise<Map<string, number>> {
  const fallbackMap = new Map<string, number>();
  for (const a of assignments) fallbackMap.set(a.id, 60);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallbackMap;

  const list = assignments
    .map((a) => `- "${a.title}" (course: ${a.courseName ?? 'unknown'}, due: ${a.dueDate ?? 'none'})`)
    .join('\n');

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are a study time estimator for college students. Given a list of assignments, estimate how many minutes each will take to complete. Return ONLY a JSON object with key "estimates" containing an array of objects: {"title": string, "minutes": number}. No markdown, no explanation.',
          },
          { role: 'user', content: list },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 500,
        temperature: 0.2,
      }),
    });

    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = data.choices[0]?.message?.content;
    if (!content) throw new Error('Empty LLM response');

    const parsed = JSON.parse(content) as
      | { estimates: Array<{ title: string; minutes: number }> }
      | Array<{ title: string; minutes: number }>;
    const arr = Array.isArray(parsed)
      ? parsed
      : (parsed as { estimates: Array<{ title: string; minutes: number }> }).estimates ??
        (Object.values(parsed)[0] as Array<{ title: string; minutes: number }>);

    if (Array.isArray(arr)) {
      // Map title → minutes, then match back to assignment IDs
      const titleMap = new Map<string, number>();
      for (const e of arr) {
        if (typeof e.title === 'string' && typeof e.minutes === 'number' && e.minutes > 0) {
          titleMap.set(e.title, Math.min(e.minutes, 480));
        }
      }
      const m = new Map<string, number>();
      for (const a of assignments) {
        m.set(a.id, titleMap.get(a.title) ?? 60);
      }
      return m;
    }
    throw new Error('Unexpected LLM format');
  } catch (err) {
    console.warn('[classroom/sync] LLM duration estimation failed, using defaults:', err);
    return fallbackMap;
  }
}

export async function POST() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();

  // Load Google access token
  const { data: tokenRow } = await supabase
    .from('user_tokens')
    .select('google_access_token')
    .eq('user_id', user.id)
    .single();

  const accessToken = (tokenRow as { google_access_token?: string | null } | null)
    ?.google_access_token;

  if (!accessToken) {
    return NextResponse.json(
      { error: 'Google not connected. Sign in with Google first.' },
      { status: 400 },
    );
  }

  try {
    const assignments = await fetchUpcomingClassroomAssignments(accessToken);

    // Filter out already-imported assignments
    const { data: alreadyImported } = await supabase
      .from('classroom_imported_assignments')
      .select('classroom_assignment_id')
      .eq('user_id', user.id);

    const importedIds = new Set(
      ((alreadyImported ?? []) as Array<{ classroom_assignment_id: string }>).map(
        (r) => r.classroom_assignment_id,
      ),
    );
    const newAssignments = assignments.filter((a) => !importedIds.has(a.id));

    if (newAssignments.length === 0) {
      await supabase
        .from('user_tokens')
        .update({ classroom_last_synced: new Date().toISOString(), classroom_connected: true })
        .eq('user_id', user.id);
      return NextResponse.json({ imported: [], count: 0, message: 'No new assignments found' });
    }

    // Estimate durations via LLM
    const estimateMap = await estimateAssignmentDurations(newAssignments);

    // Load user work hours + timezone for scheduling
    const wh = await fetchWorkHours(supabase, user.id);
    const timezone = await fetchUserTimezone(supabase, user.id) ?? 'America/Chicago';

    // Build busy intervals from existing tasks + calendar events for scheduling
    const now = new Date();
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + 14);

    const [{ data: existingTasks }, { data: calEvents }] = await Promise.all([
      supabase
        .from('tasks')
        .select('scheduled_start, scheduled_end')
        .eq('user_id', user.id)
        .not('status', 'in', '("completed","cancelled")')
        .not('scheduled_start', 'is', null)
        .gte('scheduled_start', now.toISOString())
        .lt('scheduled_start', windowEnd.toISOString()),
      supabase
        .from('calendar_events')
        .select('start_time, end_time')
        .eq('user_id', user.id)
        .gte('start_time', now.toISOString())
        .lt('start_time', windowEnd.toISOString()),
    ]);

    const busyIntervals: BusyInterval[] = [
      ...((existingTasks ?? []) as Array<{ scheduled_start: string; scheduled_end: string }>)
        .filter((t) => t.scheduled_start && t.scheduled_end)
        .map((t) => ({ start: new Date(t.scheduled_start), end: new Date(t.scheduled_end) })),
      ...((calEvents ?? []) as Array<{ start_time: string; end_time: string }>)
        .map((e) => ({ start: new Date(e.start_time), end: new Date(e.end_time) })),
    ];

    // Try to get GCal client for event creation
    const calendar = await getCalendarClient(supabase, user.id);
    let tsCalendarId: string | null = null;
    if (calendar) {
      try {
        tsCalendarId = await getOrCreateTimeSlotCalendar(supabase, user.id, calendar);
      } catch { /* non-fatal */ }
    }

    // Insert tasks + import records
    const createdTasks: Array<Record<string, unknown>> = [];

    for (const assignment of newAssignments) {
      const estimatedMinutes = estimateMap.get(assignment.id) ?? 60;

      // Schedule the task
      const slot = fallbackSchedule(busyIntervals, estimatedMinutes, assignment.dueDate ?? undefined, timezone, wh);
      const scheduledStart = slot.scheduled_start;
      const scheduledEnd = slot.scheduled_end;

      // Add this slot to busy intervals so subsequent tasks don't overlap
      busyIntervals.push({ start: new Date(scheduledStart), end: new Date(scheduledEnd) });

      const { data: task, error: insertErr } = await supabase
        .from('tasks')
        .insert({
          user_id: user.id,
          title: assignment.title,
          description: assignment.courseName ? `Course: ${assignment.courseName}` : null,
          tag: 'Study',
          estimated_minutes: estimatedMinutes,
          deadline: assignment.dueDate,
          scheduled_start: scheduledStart,
          scheduled_end: scheduledEnd,
          status: 'pending',
          source: 'classroom',
        })
        .select('id, title, estimated_minutes, deadline, scheduled_start, scheduled_end, status, source')
        .single();

      if (insertErr) {
        console.warn(
          `[classroom/sync] Failed to insert task for "${assignment.title}":`,
          insertErr,
        );
        continue;
      }

      // Create GCal event (non-fatal)
      if (calendar && tsCalendarId) {
        try {
          const tagColor = getTagColor('Study');
          const event = await calendar.events.insert({
            calendarId: tsCalendarId,
            requestBody: {
              summary: assignment.title,
              description: assignment.courseName ? `Course: ${assignment.courseName}` : undefined,
              start: { dateTime: scheduledStart },
              end: { dateTime: scheduledEnd },
              colorId: tagColor?.gcalColorId ?? getPriorityColorId(null),
            },
          });
          if (event.data.id) {
            await supabase
              .from('tasks')
              .update({ google_event_id: event.data.id })
              .eq('id', task.id);
          }
        } catch {
          /* non-fatal */
        }
      }

      await supabase.from('classroom_imported_assignments').insert({
        user_id: user.id,
        classroom_assignment_id: assignment.id,
        classroom_course_id: assignment.courseId,
        task_id: task.id,
      });

      createdTasks.push(task);
    }

    // Update last synced timestamp
    await supabase
      .from('user_tokens')
      .update({ classroom_last_synced: new Date().toISOString(), classroom_connected: true })
      .eq('user_id', user.id);

    return NextResponse.json({ imported: createdTasks, count: createdTasks.length });
  } catch (err) {
    console.error('[classroom/sync] error:', err);
    const message = err instanceof Error ? err.message : 'Classroom sync failed';

    if (message.includes('401') || message.includes('403')) {
      // Mark as disconnected so the UI shows re-authorize
      await supabase
        .from('user_tokens')
        .update({ classroom_connected: false })
        .eq('user_id', user.id);
      return NextResponse.json(
        { error: 'Classroom access not authorized. Please re-connect Google with Classroom permissions.' },
        { status: 401 },
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE — clear import history so assignments can be re-imported on next sync.
 *  Preserves records for completed tasks to avoid duplicating them. */
export async function DELETE() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();

  // Fetch all import records with their linked task IDs
  const { data: imports } = await supabase
    .from('classroom_imported_assignments')
    .select('id, task_id')
    .eq('user_id', user.id);

  if (!imports || imports.length === 0) {
    return NextResponse.json({ success: true });
  }

  // Find which linked tasks are completed
  const taskIds = (imports as Array<{ id: string; task_id: string | null }>)
    .map((r) => r.task_id)
    .filter((id): id is string => id !== null);

  let completedTaskIds = new Set<string>();
  if (taskIds.length > 0) {
    const { data: completed } = await supabase
      .from('tasks')
      .select('id')
      .in('id', taskIds)
      .eq('status', 'completed');
    completedTaskIds = new Set(
      ((completed ?? []) as Array<{ id: string }>).map((t) => t.id),
    );
  }

  // Only delete import records whose task is NOT completed
  const idsToDelete = (imports as Array<{ id: string; task_id: string | null }>)
    .filter((r) => !r.task_id || !completedTaskIds.has(r.task_id))
    .map((r) => r.id);

  if (idsToDelete.length > 0) {
    await supabase
      .from('classroom_imported_assignments')
      .delete()
      .in('id', idsToDelete);
  }

  return NextResponse.json({ success: true });
}
