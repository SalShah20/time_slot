import { NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { fetchUpcomingAssignments } from '@/lib/canvasApi';
import type { CanvasAssignment } from '@/lib/canvasApi';

/**
 * Estimate duration for a batch of assignments via GPT-4o-mini.
 * Returns a map of assignment name → estimated minutes.
 * Falls back to 60 min per assignment on any failure.
 */
async function estimateAssignmentDurations(
  assignments: CanvasAssignment[],
): Promise<Map<string, number>> {
  const fallbackMap = new Map<string, number>();
  for (const a of assignments) fallbackMap.set(a.name, 60);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallbackMap;

  const list = assignments
    .map((a) => `- "${a.name}" (course: ${a.course_name ?? 'unknown'}, due: ${a.due_at})`)
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
              'You are a study time estimator for college students. Given a list of assignments, estimate how many minutes each will take to complete. Return ONLY a JSON array with objects: {"name": string, "minutes": number}. No markdown, no explanation.',
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
      | Array<{ name: string; minutes: number }>
      | { estimates: Array<{ name: string; minutes: number }> };
    const arr = Array.isArray(parsed)
      ? parsed
      : (parsed as { estimates: Array<{ name: string; minutes: number }> }).estimates ??
        Object.values(parsed)[0];

    if (Array.isArray(arr)) {
      const m = new Map<string, number>();
      for (const e of arr) {
        if (typeof e.name === 'string' && typeof e.minutes === 'number' && e.minutes > 0) {
          m.set(e.name, Math.min(e.minutes, 480));
        }
      }
      // Fill in any missing with fallback
      for (const a of assignments) {
        if (!m.has(a.name)) m.set(a.name, 60);
      }
      return m;
    }
    throw new Error('Unexpected LLM format');
  } catch (err) {
    console.warn('[canvas/sync] LLM duration estimation failed, using defaults:', err);
    return fallbackMap;
  }
}

export async function POST() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();

  // Load Canvas credentials (never leak the token in response)
  const { data: tokenRow } = await supabase
    .from('user_tokens')
    .select('canvas_token, canvas_domain')
    .eq('user_id', user.id)
    .single();

  const canvasToken = (tokenRow as { canvas_token?: string | null } | null)?.canvas_token;
  const canvasDomain = (tokenRow as { canvas_domain?: string | null } | null)?.canvas_domain;

  if (!canvasToken || !canvasDomain) {
    return NextResponse.json({ error: 'Canvas not connected. Add your token in Settings.' }, { status: 400 });
  }

  try {
    const assignments = await fetchUpcomingAssignments(canvasDomain, canvasToken);

    // Filter out already-imported assignments
    const { data: alreadyImported } = await supabase
      .from('canvas_imported_assignments')
      .select('canvas_assignment_id')
      .eq('user_id', user.id);

    const importedIds = new Set(
      ((alreadyImported ?? []) as Array<{ canvas_assignment_id: string }>).map(
        (r) => r.canvas_assignment_id,
      ),
    );
    const newAssignments = assignments.filter((a) => !importedIds.has(String(a.id)));

    if (newAssignments.length === 0) {
      // Update last-synced even with nothing new
      await supabase
        .from('user_tokens')
        .update({ canvas_last_synced: new Date().toISOString() })
        .eq('user_id', user.id);
      return NextResponse.json({ imported: [], count: 0, message: 'No new assignments found' });
    }

    // Estimate durations via LLM
    const estimateMap = await estimateAssignmentDurations(newAssignments);

    // Insert tasks + import records
    const createdTasks: Array<Record<string, unknown>> = [];

    for (const assignment of newAssignments) {
      const estimatedMinutes = estimateMap.get(assignment.name) ?? 60;

      const { data: task, error: insertErr } = await supabase
        .from('tasks')
        .insert({
          user_id: user.id,
          title: assignment.name,
          description: assignment.course_name ? `Course: ${assignment.course_name}` : null,
          tag: 'Study',
          estimated_minutes: estimatedMinutes,
          deadline: assignment.due_at,
          status: 'pending',
          source: 'canvas',
        })
        .select('id, title, estimated_minutes, deadline, scheduled_start, status, source')
        .single();

      if (insertErr) {
        console.warn(`[canvas/sync] Failed to insert task for "${assignment.name}":`, insertErr);
        continue;
      }

      await supabase.from('canvas_imported_assignments').insert({
        user_id: user.id,
        canvas_assignment_id: String(assignment.id),
        canvas_course_id: String(assignment.course_id),
        task_id: task.id,
      });

      createdTasks.push(task);
    }

    // Update last synced timestamp
    await supabase
      .from('user_tokens')
      .update({ canvas_last_synced: new Date().toISOString() })
      .eq('user_id', user.id);

    return NextResponse.json({ imported: createdTasks, count: createdTasks.length });
  } catch (err) {
    console.error('[canvas/sync] error:', err);
    const message = err instanceof Error ? err.message : 'Canvas sync failed';

    // Detect auth failures
    if (message.includes('401') || message.includes('403')) {
      return NextResponse.json(
        { error: 'Your Canvas token has expired. Please reconnect in Settings.' },
        { status: 401 },
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
