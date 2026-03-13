import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchUserTimingHistory } from './timingHistory';

export type DurationSource = 'historical' | 'llm' | 'tag-fallback';

export interface DurationEstimate {
  minutes: number;
  source: DurationSource;
}

/**
 * Returns the median actual work duration for completed tasks with the same tag.
 * Requires at least 2 data points to be meaningful; returns null otherwise.
 */
export async function getHistoricalDuration(
  supabase: SupabaseClient,
  userId: string,
  tag: string,
): Promise<number | null> {
  const { data } = await supabase
    .from('tasks')
    .select('actual_duration')
    .eq('user_id', userId)
    .eq('tag', tag)
    .eq('status', 'completed')
    .not('actual_duration', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(10);

  if (!data || data.length === 0) return null;

  const actuals = data
    .map((t) => Math.round((t.actual_duration as number) / 60))
    .filter((d) => d > 0);

  if (actuals.length < 2) return null;

  const sorted = [...actuals].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * LLM-powered duration estimator with historical shortcut.
 *
 * Priority order:
 *   1. User's own historical median for the same tag (skips LLM entirely)
 *   2. GPT-4o-mini estimate calibrated against the user's timing history
 *   3. Tag-based default (no API key or LLM failure)
 *
 * Pass `supabase` + `userId` to enable the historical shortcut and
 * automatic history fetching for LLM calibration.
 */
export async function estimateDurationWithLLM(
  title: string,
  description?: string | null,
  tag?: string | null,
  priority?: string | null,
  supabase?: SupabaseClient,
  userId?: string,
): Promise<DurationEstimate> {
  // ── 1. Historical shortcut: skip LLM if enough past data ──────────────────
  if (supabase && userId && tag) {
    const historical = await getHistoricalDuration(supabase, userId, tag);
    if (historical !== null) {
      console.log(`[estimateDuration] "${title}" → ${historical}m (historical median, tag: ${tag})`);
      return { minutes: historical, source: 'historical' };
    }
  }

  // ── 2. Fetch timing history for LLM calibration ───────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return { minutes: tagDefault(tag), source: 'tag-fallback' };
  }

  const history = supabase && userId
    ? await fetchUserTimingHistory(supabase, userId)
    : undefined;

  // Build the history section only when there is something useful to say
  let historySection = '';
  if (history) {
    const lines: string[] = [];

    const tags = Object.entries(history.tagStats);
    if (tags.length > 0) {
      lines.push("User's actual tag averages (from their own completed tasks):");
      for (const [t, { avgMinutes, count }] of tags) {
        lines.push(`  ${t}: ${avgMinutes} min avg (${count} task${count !== 1 ? 's' : ''})`);
      }
    }

    if (history.recentTasks.length > 0) {
      lines.push("User's recent task history (title → actual minutes taken):");
      for (const t of history.recentTasks) {
        const diff = t.actualMinutes - t.estimatedMinutes;
        const diffStr = diff > 0 ? `+${diff}` : String(diff);
        lines.push(`  "${t.title}"${t.tag ? ` [${t.tag}]` : ''}: ${t.actualMinutes} min (est was ${t.estimatedMinutes}, ${diffStr})`);
      }
    }

    if (lines.length > 0) {
      historySection = '\n\n' + lines.join('\n');
    }
  }

  const prompt = `Estimate how long this task will take a college student, in minutes. Return ONLY a whole number (no units, no explanation).

Task: ${title}${description ? `\nDescription: ${description}` : ''}${tag ? `\nTag: ${tag}` : ''}${priority ? `\nPriority: ${priority}` : ''}${historySection}

Guidelines (use history above to override these when relevant):
- Study/homework: 60–180 min
- "midterm", "final", "essay", "paper", "lab report": longer, often 2+ hours
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
      console.log(`[estimateDuration] "${title}" → ${minutes} min (LLM${historySection ? '+history' : ''})`);
      return { minutes, source: 'llm' };
    }

    throw new Error(`Unexpected LLM value: "${raw}"`);
  } catch (err) {
    console.warn('[estimateDuration] Falling back to tag default:', err);
    return { minutes: tagDefault(tag), source: 'tag-fallback' };
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
