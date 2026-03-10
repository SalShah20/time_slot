import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/supabase-server';

interface ParsedTask {
  title: string;
  estimatedMinutes?: number;
  priority?: string;
  tag?: string;
  deadline?: string;
  description?: string;
  isFixed?: boolean;
  fixedStart?: string;
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { input, timezone = 'UTC' } = await req.json() as { input?: string; timezone?: string };

  if (!input?.trim()) {
    return NextResponse.json({ error: 'No input provided' }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'AI unavailable — OPENAI_API_KEY not configured' },
      { status: 500 },
    );
  }

  const now = new Date();
  const localTime = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(now);
  const localDate = new Intl.DateTimeFormat('sv', { timeZone: timezone }).format(now);

  const systemPrompt = `You are a task parser for a student scheduling app.

CURRENT TIME: ${now.toISOString()} UTC = ${localTime} (${timezone})
TODAY (local): ${localDate}

Parse the user's input into structured tasks. For each task extract:
- title (required): clear, action-oriented task name
- estimatedMinutes (optional): parse "2 hours"→120, "90 min"→90, "1.5h"→90, "30m"→30. Omit if not mentioned.
- priority (optional): "high" for urgent/important, "low" for low priority, "medium" otherwise. Default: "medium".
- tag (optional): one of Study, Work, Personal, Exercise, Health, Social, Errands, Other — infer from context.
- deadline (optional): UTC ISO 8601 string. Resolve relative dates from ${localDate} in ${timezone}:
  "tomorrow" → tomorrow at 23:59 local → convert to UTC
  "Friday" → this coming Friday at 23:59 local → convert to UTC
  "next Monday" → next Monday at 23:59 local → convert to UTC
  "by 3pm" → today at 15:00 local → convert to UTC
  Omit if no deadline is mentioned.
- isFixed (optional boolean): set to true ONLY when the user specifies an exact time to DO the task.
  YES: "check into flight at 3pm", "meeting at 2:30pm", "call dentist at 10am tomorrow", "class at 9am"
  NO: "finish essay by 3pm" (that's a deadline), "study sometime today" (no specific time)
- fixedStart (optional): when isFixed is true, the UTC ISO 8601 datetime for the pinned start time.
  Convert from local time using timezone ${timezone}.

Rules:
- One task per input line (or clearly separated phrase)
- If multiple tasks, include all of them
- Only include fields you're confident about — omit rather than guess poorly
- title must be concise but clear

Respond ONLY with valid JSON (no markdown):
{"tasks":[{"title":"...","estimatedMinutes":120,"priority":"high","tag":"Study","deadline":"2026-03-07T04:59:00Z"}]}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input.trim() },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const content = data.choices[0]?.message?.content;
    if (!content) throw new Error('Empty AI response');

    const parsed = JSON.parse(content) as { tasks?: ParsedTask[] };
    const rawTasks = parsed.tasks ?? [];

    if (rawTasks.length === 0) {
      return NextResponse.json(
        { error: 'Could not find any tasks in your input. Try being more specific.' },
        { status: 400 },
      );
    }

    // Normalize to TaskInput-compatible shape
    const tasks = rawTasks
      .filter((t) => t.title?.trim())
      .map((t) => ({
        title: t.title.trim(),
        description:      t.description?.trim() || undefined,
        tag:              t.tag || undefined,
        estimatedMinutes: typeof t.estimatedMinutes === 'number' && t.estimatedMinutes > 0
          ? t.estimatedMinutes
          : undefined,
        priority: (['low', 'medium', 'high'] as const).includes(t.priority as 'low' | 'medium' | 'high')
          ? (t.priority as string)
          : 'medium',
        deadline: t.deadline
          ? (() => { try { return new Date(t.deadline!).toISOString(); } catch { return undefined; } })()
          : undefined,
        isFixed: t.isFixed === true ? true : undefined,
        fixedStart: t.isFixed && t.fixedStart
          ? (() => { try { return new Date(t.fixedStart!).toISOString(); } catch { return undefined; } })()
          : undefined,
      }));

    console.log(`[/api/tasks/brain-dump] Parsed ${tasks.length} tasks from input`);

    return NextResponse.json({ tasks });
  } catch (err) {
    console.error('[/api/tasks/brain-dump]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to parse tasks' },
      { status: 500 },
    );
  }
}
