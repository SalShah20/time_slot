/**
 * LLM-powered duration estimator.
 * Called when a task is submitted without a manual duration.
 * Falls back to tag-based defaults if the API key is missing or the call fails.
 */
export async function estimateDurationWithLLM(
  title: string,
  description?: string | null,
  tag?: string | null,
  priority?: string | null,
): Promise<number> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return tagDefault(tag);
  }

  const prompt = `Estimate how long this task will take a college student, in minutes. Return ONLY a whole number (no units, no explanation).

Task: ${title}${description ? `\nDescription: ${description}` : ''}${tag ? `\nTag: ${tag}` : ''}${priority ? `\nPriority: ${priority}` : ''}

Guidelines:
- Study/homework: 60–180 min
- Work tasks: 60–240 min
- Personal errands: 30–90 min
- Exercise: 30–90 min
- Quick tasks (< 15 min based on title): 15 min
- If completely unclear: 60 min`;

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
        max_tokens: 10,
        temperature: 0.2,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const raw = data.choices[0]?.message?.content?.trim() ?? '';
    const minutes = parseInt(raw, 10);

    if (!isNaN(minutes) && minutes > 0 && minutes <= 480) {
      console.log(`[estimateDuration] "${title}" → ${minutes} min (LLM)`);
      return minutes;
    }

    throw new Error(`Unexpected LLM value: "${raw}"`);
  } catch (err) {
    console.warn('[estimateDuration] Falling back to tag default:', err);
    return tagDefault(tag);
  }
}

function tagDefault(tag?: string | null): number {
  const map: Record<string, number> = {
    Study: 90, Work: 120, Personal: 45, Exercise: 60,
    Health: 60, Social: 60, Errands: 45, Other: 60,
  };
  if (tag) {
    const normalized = tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();
    if (normalized in map) return map[normalized];
  }
  return 60;
}
