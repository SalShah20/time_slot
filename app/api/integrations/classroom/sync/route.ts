import { NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { fetchUpcomingClassroomAssignments } from '@/lib/googleClassroom';
import type { ClassroomAssignment } from '@/lib/googleClassroom';

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

    // Insert tasks + import records
    const createdTasks: Array<Record<string, unknown>> = [];

    for (const assignment of newAssignments) {
      const estimatedMinutes = estimateMap.get(assignment.id) ?? 60;

      const { data: task, error: insertErr } = await supabase
        .from('tasks')
        .insert({
          user_id: user.id,
          title: assignment.title,
          description: assignment.courseName ? `Course: ${assignment.courseName}` : null,
          tag: 'Study',
          estimated_minutes: estimatedMinutes,
          deadline: assignment.dueDate,
          status: 'pending',
          source: 'classroom',
        })
        .select('id, title, estimated_minutes, deadline, scheduled_start, status, source')
        .single();

      if (insertErr) {
        console.warn(
          `[classroom/sync] Failed to insert task for "${assignment.title}":`,
          insertErr,
        );
        continue;
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
