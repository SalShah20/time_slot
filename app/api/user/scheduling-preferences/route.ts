import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';

/** GET — return current scheduling preferences. */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();
  const { data } = await supabase
    .from('user_tokens')
    .select('scheduling_context, scheduling_notes, work_start_hour, work_end_hour, work_end_late_hour, prefer_mornings, prefer_evenings, avoid_back_to_back')
    .eq('user_id', user.id)
    .single();

  if (!data) {
    return NextResponse.json({});
  }

  return NextResponse.json({
    schedulingContext: (data as Record<string, unknown>).scheduling_context ?? null,
    schedulingNotes:   (data as Record<string, unknown>).scheduling_notes ?? null,
    workStartHour:     (data as Record<string, unknown>).work_start_hour ?? 8,
    workEndHour:       (data as Record<string, unknown>).work_end_hour ?? 23,
    workEndLateHour:   (data as Record<string, unknown>).work_end_late_hour ?? 3,
    preferMornings:    (data as Record<string, unknown>).prefer_mornings ?? false,
    preferEvenings:    (data as Record<string, unknown>).prefer_evenings ?? false,
    avoidBackToBack:   (data as Record<string, unknown>).avoid_back_to_back ?? false,
  });
}

/** POST — parse a freeform paragraph into structured scheduling preferences. */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { context } = (await req.json()) as { context?: string };
  if (!context?.trim()) {
    return NextResponse.json({ error: 'No input provided' }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'AI unavailable — OPENAI_API_KEY not configured' }, { status: 500 });
  }

  const systemPrompt = `You are a scheduling assistant. Parse the user's description of their schedule preferences into structured data.

Return ONLY a raw JSON object (no markdown) with these fields:
- work_start_hour (number, 0–23.5, half-hour increments): earliest hour to schedule tasks. Default 8.
- work_end_hour (number, 0–23.5, half-hour increments): latest preferred end hour. Default 23.
- work_end_late_hour (number, 0–23.5, half-hour increments): absolute latest "last resort" hour (e.g. 3 = 3 AM). Must be less than work_start_hour to form a blackout window. Default 3.
- prefer_mornings (boolean): user prefers tasks scheduled in the morning.
- prefer_evenings (boolean): user prefers tasks scheduled in the evening.
- avoid_back_to_back (boolean): user wants buffer time between tasks.
- scheduling_notes (string): 1–2 sentence plain English summary of what you parsed, to show back to the user.

Half-hour values are allowed: 8.5 = 8:30 AM, 22.5 = 10:30 PM, etc.

Examples:
- "I'm a night owl, please don't schedule anything before 10am" → work_start_hour: 10
- "I usually stop working around 11:30pm and go to bed at 2am" → work_end_hour: 23.5, work_end_late_hour: 2
- "I like getting hard tasks done in the morning" → prefer_mornings: true
- "I need breaks between tasks, I can't do back to back stuff" → avoid_back_to_back: true
- "I'm free all day but prefer evenings after 6" → prefer_evenings: true, work_start_hour: 8`;

  let parsed: Record<string, unknown> = {};
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
          { role: 'system', content: systemPrompt },
          { role: 'user', content: context.trim() },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 300,
        temperature: 0.1,
      }),
    });

    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);

    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const content = data.choices[0]?.message?.content;
    if (!content) throw new Error('Empty AI response');

    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    console.warn('[scheduling-preferences] LLM parsing failed:', err);
    parsed = { scheduling_notes: 'Could not parse preferences — using defaults.' };
  }

  // Build update payload, only including valid values
  const supabase = createSupabaseServer();
  const update: Record<string, unknown> = {
    scheduling_context: context.trim(),
  };

  if (typeof parsed.scheduling_notes === 'string') {
    update.scheduling_notes = parsed.scheduling_notes;
  }
  if (typeof parsed.work_start_hour === 'number' && parsed.work_start_hour >= 0 && parsed.work_start_hour <= 23.5) {
    update.work_start_hour = parsed.work_start_hour;
  }
  if (typeof parsed.work_end_hour === 'number' && parsed.work_end_hour >= 0 && parsed.work_end_hour <= 23.5) {
    update.work_end_hour = parsed.work_end_hour;
  }
  if (typeof parsed.work_end_late_hour === 'number' && parsed.work_end_late_hour >= 0 && parsed.work_end_late_hour <= 23.5) {
    update.work_end_late_hour = parsed.work_end_late_hour;
  }
  if (typeof parsed.prefer_mornings === 'boolean') {
    update.prefer_mornings = parsed.prefer_mornings;
  }
  if (typeof parsed.prefer_evenings === 'boolean') {
    update.prefer_evenings = parsed.prefer_evenings;
  }
  if (typeof parsed.avoid_back_to_back === 'boolean') {
    update.avoid_back_to_back = parsed.avoid_back_to_back;
  }

  // Also save timezone if available
  update.work_timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const { error } = await supabase
    .from('user_tokens')
    .update(update)
    .eq('user_id', user.id);

  if (error) {
    console.error('[scheduling-preferences] DB update error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log('[scheduling-preferences] Saved preferences for user', user.id, update);

  return NextResponse.json({ success: true, parsed });
}
