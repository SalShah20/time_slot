const BUILTIN_TAGS = ['Study', 'Work', 'Personal', 'Exercise', 'Health', 'Social', 'Errands', 'Other'];

/** Keyword-based fallback for when no API key is available. */
function keywordGuessTag(title: string, description?: string | null): string | null {
  const text = `${title} ${description ?? ''}`.toLowerCase();

  // Academic / class work
  if (/\b(homework|hw|assignment|quiz|exam|midterm|final|lecture|lab\s+report|essay|paper|problem\s*set|pset|chapter|textbook|study|review|notes|reading|cs\s*\d|math\s*\d|eng\s*\d|bio\s*\d|chem\s*\d|phys\s*\d|hist\s*\d|econ\s*\d)\b/.test(text)) {
    return 'Study';
  }
  // Exercise
  if (/\b(gym|workout|run|running|jog|yoga|exercise|lift|weights|cardio|swim|bike|cycling|hike|walk|push.?up|pull.?up|squat)\b/.test(text)) {
    return 'Exercise';
  }
  // Health / medical
  if (/\b(doctor|dentist|appointment|medicine|medication|therapy|health|checkup|prescription|clinic|hospital)\b/.test(text)) {
    return 'Health';
  }
  // Work / professional
  if (/\b(meeting|project|deadline|presentation|email|report|client|internship|interview|standup|sprint|ticket|jira|pr|pull\s+request)\b/.test(text)) {
    return 'Work';
  }
  // Social
  if (/\b(dinner|lunch|party|friend|family|hang\s+out|coffee|date|birthday|wedding|brunch|social|movie)\b/.test(text)) {
    return 'Social';
  }
  // Errands
  if (/\b(grocery|groceries|shopping|store|pick\s+up|drop\s+off|errand|bank|post\s+office|mail|laundry|clean|chore|dish|vacuum)\b/.test(text)) {
    return 'Errands';
  }
  // Personal
  if (/\b(journal|meditation|read|hobby|cook|budget|plan|organize|self|personal)\b/.test(text)) {
    return 'Personal';
  }

  return null;
}

/**
 * Guesses the best tag for a task using GPT-4o-mini.
 * Falls back to keyword matching if the API key is missing or the call fails.
 * Returns null if no confident guess can be made (caller should leave tag as null).
 */
export async function guessTagWithLLM(title: string, description?: string | null): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return keywordGuessTag(title, description);
  }

  const prompt = `What tag best describes this task for a college student?

Task: ${title}${description ? `\nDescription: ${description}` : ''}

Choose exactly one from this list: ${BUILTIN_TAGS.join(', ')}

Rules:
- Academic work (homework, exam, essay, study, class assignment, course name like "CS 101") → Study
- Professional work (meeting, project, presentation, internship) → Work
- Physical activity (gym, run, yoga, sports) → Exercise
- Medical/health (doctor, dentist, medicine, therapy) → Health
- Social (friends, party, dinner, dating) → Social
- Shopping/chores (grocery, errand, laundry) → Errands
- Self-care/personal (journal, cook, hobbies) → Personal
- Unclear → Other

Return ONLY the tag name, nothing else.`;

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
        temperature: 0,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const raw = data.choices[0]?.message?.content?.trim() ?? '';

    if (BUILTIN_TAGS.includes(raw)) {
      console.log(`[guessTag] "${title}" → ${raw}`);
      return raw;
    }

    throw new Error(`Unexpected tag: "${raw}"`);
  } catch (err) {
    console.warn('[guessTag] Falling back to keyword matching:', err);
    return keywordGuessTag(title, description);
  }
}
