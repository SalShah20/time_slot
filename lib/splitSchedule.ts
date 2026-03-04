import { findFreeBlocksInWindow } from '@/lib/scheduleUtils';
import type { BusyInterval, FreeBlock } from '@/lib/scheduleUtils';

const MIN_SESSION_MINUTES = 45;

export interface SplitSession {
  scheduled_start: string;
  scheduled_end: string;
  durationMinutes: number;
}

interface SplitInput {
  title: string;
  estimatedMinutes: number;
  deadline: string;
  priority?: string | null;
  tag?: string | null;
}

/**
 * Calls GPT-4o-mini to split a task into sessions across the provided free blocks.
 * Returns sessions or null on any error / validation failure.
 */
async function splitTaskWithLLM(
  task: SplitInput,
  freeBlocks: FreeBlock[],
  busyIntervals: BusyInterval[],
  deadline: Date,
): Promise<SplitSession[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const blocksForPrompt = freeBlocks.map((b) => ({
    start:            b.start.toISOString(),
    end:              b.end.toISOString(),
    duration_minutes: Math.round(b.durationMinutes),
  }));

  const prompt = `Split a task into focused work sessions.

TASK: "${task.title}" — ${task.estimatedMinutes} min total, due ${task.deadline}${task.priority ? `\nPriority: ${task.priority}` : ''}${task.tag ? ` | Tag: ${task.tag}` : ''}

AVAILABLE FREE BLOCKS:
${JSON.stringify(blocksForPrompt)}

RULES:
1. Minimum ${MIN_SESSION_MINUTES} min per session
2. Sessions must sum to exactly ${task.estimatedMinutes} min total
3. Each session must fit entirely within one of the available free blocks
4. All sessions must end before the deadline: ${task.deadline}
5. ${task.priority === 'high' ? 'Schedule earlier slots first (high priority)' : 'Spread sessions out rather than cramming them together'}

Reply ONLY with a JSON object (no text before or after):
{"sessions":[{"start":"ISO 8601","end":"ISO 8601","duration_minutes":N},...]}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:           'gpt-4o-mini',
        messages:        [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens:      600,
        temperature:     0.1,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const content = data.choices[0]?.message?.content;
    if (!content) throw new Error('Empty LLM response');

    const parsed = JSON.parse(content) as {
      sessions: Array<{ start: string; end: string; duration_minutes: number }>;
    };

    const sessions = parsed.sessions;
    if (!Array.isArray(sessions) || sessions.length === 0) throw new Error('Invalid sessions array');

    // Validate: each session >= MIN_SESSION_MINUTES
    for (const s of sessions) {
      if (s.duration_minutes < MIN_SESSION_MINUTES) {
        throw new Error(`Session too short: ${s.duration_minutes} min`);
      }
    }

    // Validate: total >= estimatedMinutes
    const total = sessions.reduce((sum, s) => sum + s.duration_minutes, 0);
    if (total < task.estimatedMinutes) {
      throw new Error(`Sessions total ${total} < required ${task.estimatedMinutes}`);
    }

    // Validate: all sessions within deadline
    for (const s of sessions) {
      if (new Date(s.end) > deadline) throw new Error(`Session end ${s.end} exceeds deadline`);
    }

    // Validate: no overlaps with busy intervals
    for (const s of sessions) {
      const sStart = new Date(s.start);
      const sEnd   = new Date(s.end);
      if (busyIntervals.some((iv) => iv.start < sEnd && iv.end > sStart)) {
        throw new Error(`Session overlaps a busy interval`);
      }
    }

    console.log(`[splitTaskWithLLM] "${task.title}" → ${sessions.length} sessions`);
    return sessions.map((s) => ({
      scheduled_start: s.start,
      scheduled_end:   s.end,
      durationMinutes: s.duration_minutes,
    }));
  } catch (err) {
    console.warn('[splitTaskWithLLM] Error, falling back to greedy:', err);
    return null;
  }
}

/**
 * Deterministic fallback: greedily fills available free blocks in chronological order.
 * Skips blocks < MIN_SESSION_MINUTES unless they're the final remaining piece.
 * Returns empty array if it can't cover the full duration.
 */
function splitTaskGreedy(freeBlocks: FreeBlock[], estimatedMinutes: number): SplitSession[] {
  const sessions: SplitSession[] = [];
  let remaining = estimatedMinutes;

  for (const block of freeBlocks) {
    if (remaining <= 0) break;

    // Skip blocks too small for a meaningful session (unless it's the last piece we need)
    if (block.durationMinutes < MIN_SESSION_MINUTES && remaining >= MIN_SESSION_MINUTES) continue;

    const sessionMinutes = Math.min(Math.floor(block.durationMinutes), remaining);
    const sessionEnd     = new Date(block.start.getTime() + sessionMinutes * 60_000);

    sessions.push({
      scheduled_start: block.start.toISOString(),
      scheduled_end:   sessionEnd.toISOString(),
      durationMinutes: sessionMinutes,
    });

    remaining -= sessionMinutes;
  }

  if (remaining > 0) return []; // couldn't cover the full duration
  return sessions;
}

/**
 * Main entry point.
 *
 * Returns ordered split sessions totalling task.estimatedMinutes, or null if:
 * - task is too short to be worth splitting (< 2 × MIN_SESSION_MINUTES)
 * - there's not enough free time before the deadline
 * - greedy fallback also fails to cover the full duration
 */
export async function computeSplitSessions(
  task: SplitInput,
  busyIntervals: BusyInterval[],
  deadline: Date,
  timezone: string,
): Promise<SplitSession[] | null> {
  // Not worth splitting if we can't fit at least two minimum-length sessions
  if (task.estimatedMinutes < MIN_SESSION_MINUTES * 2) return null;

  const from       = new Date(Date.now() + 10 * 60_000); // now + 10 min
  const freeBlocks = findFreeBlocksInWindow(busyIntervals, from, deadline, MIN_SESSION_MINUTES, timezone);

  // Bail early if there's not enough total free time
  const totalFreeMinutes = freeBlocks.reduce((sum, b) => sum + b.durationMinutes, 0);
  if (totalFreeMinutes < task.estimatedMinutes) {
    console.log(
      `[computeSplitSessions] Not enough free time before deadline: ` +
      `${Math.round(totalFreeMinutes)} min available < ${task.estimatedMinutes} min needed`,
    );
    return null;
  }

  // Try LLM splitting first; fall back to greedy on any error
  const llmSessions = await splitTaskWithLLM(task, freeBlocks, busyIntervals, deadline);
  if (llmSessions && llmSessions.length > 1) return llmSessions;

  const greedySessions = splitTaskGreedy(freeBlocks, task.estimatedMinutes);
  if (greedySessions.length > 1) return greedySessions;

  return null;
}
