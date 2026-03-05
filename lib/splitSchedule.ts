import { findFreeBlocksInWindow, localHourIn, WORK_START_HOUR } from '@/lib/scheduleUtils';
import type { BusyInterval, FreeBlock } from '@/lib/scheduleUtils';

/** Minimum length of a single work session. */
const MIN_SESSION_MINUTES = 30;
/** Maximum length of a single work session — caps any one sitting at 90 min. */
const MAX_SESSION_MINUTES = 90;
/** Enforced gap between consecutive sessions. */
const BUFFER_MINUTES = 15;
/** Last hour sessions may START (11 PM). Avoids late-night scheduling for splits. */
const PREFERRED_END_HOUR = 23;

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
 * Filters free blocks to the preferred 8 AM – 11 PM window.
 * Falls back to including all blocks only when the preferred set doesn't
 * have enough total time to cover the task.
 */
function preferDaytimeBlocks(
  blocks: FreeBlock[],
  estimatedMinutes: number,
  timezone: string,
): FreeBlock[] {
  const daytime = blocks.filter((b) => {
    const h = localHourIn(b.start, timezone);
    return h >= WORK_START_HOUR && h < PREFERRED_END_HOUR;
  });
  const daytimeTotal = daytime.reduce((s, b) => s + b.durationMinutes, 0);
  return daytimeTotal >= estimatedMinutes ? daytime : blocks;
}

/**
 * Calls GPT-4o-mini to split a task into sessions spread across the free blocks.
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

  const numSessions = Math.max(2, Math.ceil(task.estimatedMinutes / MAX_SESSION_MINUTES));
  const blocksForPrompt = freeBlocks.map((b) => ({
    start:            b.start.toISOString(),
    end:              b.end.toISOString(),
    duration_minutes: Math.round(b.durationMinutes),
  }));

  const prompt = `Split a task into focused work sessions spread across the available time before the deadline.

TASK: "${task.title}" — ${task.estimatedMinutes} min total, due ${task.deadline}${task.priority ? `\nPriority: ${task.priority}` : ''}${task.tag ? ` | Tag: ${task.tag}` : ''}

TARGET: ${numSessions} sessions of ~${Math.ceil(task.estimatedMinutes / numSessions)} min each

AVAILABLE FREE BLOCKS (daytime preferred, 8 AM – 11 PM):
${JSON.stringify(blocksForPrompt)}

RULES:
1. Each session: minimum ${MIN_SESSION_MINUTES} min, maximum ${MAX_SESSION_MINUTES} min
2. Sessions must sum to exactly ${task.estimatedMinutes} min total
3. Each session must fit entirely within one available free block
4. All sessions must end before the deadline: ${task.deadline}
5. Leave at least ${BUFFER_MINUTES} minutes between any two sessions
6. SPREAD sessions across the full time window before the deadline — do NOT schedule all sessions on the first day; distribute them evenly
7. Prefer sessions between 8 AM and 11 PM — never schedule a session that starts in the 3 AM–8 AM range
8. ${task.priority === 'high' ? 'Front-load sessions (schedule earlier slots first)' : 'Spread evenly across the entire window until deadline'}

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
        max_tokens:      800,
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

    // Validate: each session within allowed length
    for (const s of sessions) {
      if (s.duration_minutes < MIN_SESSION_MINUTES) throw new Error(`Session too short: ${s.duration_minutes} min`);
      if (s.duration_minutes > MAX_SESSION_MINUTES + 5) throw new Error(`Session too long: ${s.duration_minutes} min`);
    }

    // Validate: total covers the task
    const total = sessions.reduce((sum, s) => sum + s.duration_minutes, 0);
    if (total < task.estimatedMinutes) throw new Error(`Sessions total ${total} < required ${task.estimatedMinutes}`);

    // Validate: all sessions end before deadline
    for (const s of sessions) {
      if (new Date(s.end) > deadline) throw new Error(`Session end ${s.end} exceeds deadline`);
    }

    // Validate: 15-min gap between consecutive sessions
    const sorted = [...sessions].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    for (let i = 1; i < sorted.length; i++) {
      const gapMs = new Date(sorted[i].start).getTime() - new Date(sorted[i - 1].end).getTime();
      if (gapMs < BUFFER_MINUTES * 60_000) {
        throw new Error(`Sessions ${i - 1} and ${i} have less than ${BUFFER_MINUTES} min gap`);
      }
    }

    // Validate: no overlaps with busy intervals
    for (const s of sessions) {
      const sStart = new Date(s.start);
      const sEnd   = new Date(s.end);
      if (busyIntervals.some((iv) => iv.start < sEnd && iv.end > sStart)) {
        throw new Error('Session overlaps a busy interval');
      }
    }

    console.log(`[splitTaskWithLLM] "${task.title}" → ${sessions.length} sessions`);
    return sorted.map((s) => ({
      scheduled_start: s.start,
      scheduled_end:   s.end,
      durationMinutes: s.duration_minutes,
    }));
  } catch (err) {
    console.warn('[splitTaskWithLLM] Error, falling back to spread algorithm:', err);
    return null;
  }
}

/**
 * Deterministic spread algorithm:
 * Divides the window [firstBlockStart, deadline] into equal time slices and
 * picks one session per slice — ensuring sessions are spread across the full
 * deadline window rather than crammed onto the first available day.
 *
 * Falls back to a greedy pass for any remaining time not placed in the first pass.
 * Enforces BUFFER_MINUTES gap between all consecutive sessions.
 */
function splitTaskSpread(
  freeBlocks: FreeBlock[],
  estimatedMinutes: number,
  deadline: Date,
): SplitSession[] {
  if (freeBlocks.length === 0) return [];

  const numSessions   = Math.max(2, Math.ceil(estimatedMinutes / MAX_SESSION_MINUTES));
  const sessionTarget = Math.ceil(estimatedMinutes / numSessions);

  const windowStart = freeBlocks[0].start.getTime();
  const windowEnd   = deadline.getTime();
  const sliceMs     = (windowEnd - windowStart) / numSessions;

  const sessions: SplitSession[] = [];
  let remaining      = estimatedMinutes;
  let lastSessionEnd: Date | null = null;

  // First pass: one session per time slice (spread)
  for (let i = 0; i < numSessions && remaining > 0; i++) {
    const sliceStart = new Date(windowStart + i * sliceMs);
    const sliceEnd   = new Date(windowStart + (i + 1) * sliceMs);

    for (const block of freeBlocks) {
      if (block.end <= sliceStart) continue;
      if (block.start >= sliceEnd) break;

      // Enforce gap from the previous session
      const effectiveStart: Date = lastSessionEnd
        ? new Date(Math.max(block.start.getTime(), lastSessionEnd.getTime() + BUFFER_MINUTES * 60_000))
        : block.start;

      if (effectiveStart >= block.end) continue;

      const available = (block.end.getTime() - effectiveStart.getTime()) / 60_000;
      const duration  = Math.min(sessionTarget, remaining, Math.floor(available));

      if (duration < MIN_SESSION_MINUTES && remaining >= MIN_SESSION_MINUTES) continue;

      const sessionEnd = new Date(effectiveStart.getTime() + duration * 60_000);
      sessions.push({
        scheduled_start: effectiveStart.toISOString(),
        scheduled_end:   sessionEnd.toISOString(),
        durationMinutes: duration,
      });
      remaining      -= duration;
      lastSessionEnd  = sessionEnd;
      break;
    }
  }

  // Second pass: fill any remaining time greedily (with gap enforcement)
  if (remaining > 0) {
    for (const block of freeBlocks) {
      if (remaining <= 0) break;

      const effectiveStart: Date = lastSessionEnd
        ? new Date(Math.max(block.start.getTime(), lastSessionEnd.getTime() + BUFFER_MINUTES * 60_000))
        : block.start;

      if (effectiveStart >= block.end) continue;

      const available = (block.end.getTime() - effectiveStart.getTime()) / 60_000;
      const duration  = Math.min(remaining, Math.floor(available));

      if (duration < MIN_SESSION_MINUTES && remaining >= MIN_SESSION_MINUTES) continue;

      const sessionEnd = new Date(effectiveStart.getTime() + duration * 60_000);
      sessions.push({
        scheduled_start: effectiveStart.toISOString(),
        scheduled_end:   sessionEnd.toISOString(),
        durationMinutes: duration,
      });
      remaining      -= duration;
      lastSessionEnd  = sessionEnd;
    }
  }

  if (remaining > 0) return []; // couldn't cover the full duration
  return sessions;
}

/**
 * Main entry point. Splits a task into multiple sessions spread before the deadline.
 *
 * Triggered when:
 *   - The task has a deadline, AND
 *   - estimatedMinutes > 60 (any long task benefits from breaks), OR
 *   - the single best slot misses the deadline
 *
 * Returns ordered sessions totalling estimatedMinutes, or null if:
 *   - the task is too short to split meaningfully (≤ MIN_SESSION_MINUTES)
 *   - there isn't enough free daytime time before the deadline
 */
export async function computeSplitSessions(
  task: SplitInput,
  busyIntervals: BusyInterval[],
  deadline: Date,
  timezone: string,
): Promise<SplitSession[] | null> {
  // Not worth splitting a very short task
  if (task.estimatedMinutes <= MIN_SESSION_MINUTES) return null;

  // Start looking from now + 1 hour (consistent with the main scheduler buffer)
  const from = new Date(Date.now() + 60 * 60_000);

  const allBlocks   = findFreeBlocksInWindow(busyIntervals, from, deadline, MIN_SESSION_MINUTES, timezone);
  // Prefer daytime (8 AM – 11 PM) blocks; only include late-night slots if we must
  const freeBlocks  = preferDaytimeBlocks(allBlocks, task.estimatedMinutes, timezone);

  const totalFreeMinutes = freeBlocks.reduce((s, b) => s + b.durationMinutes, 0);
  if (totalFreeMinutes < task.estimatedMinutes) {
    console.log(
      `[computeSplitSessions] Not enough free daytime before deadline: ` +
      `${Math.round(totalFreeMinutes)} min available < ${task.estimatedMinutes} min needed`,
    );
    return null;
  }

  // Try LLM first; fall back to deterministic spread algorithm
  const llmSessions = await splitTaskWithLLM(task, freeBlocks, busyIntervals, deadline);
  if (llmSessions && llmSessions.length >= 1) return llmSessions;

  const spreadSessions = splitTaskSpread(freeBlocks, task.estimatedMinutes, deadline);
  if (spreadSessions.length >= 1) return spreadSessions;

  return null;
}
