import type { SupabaseClient } from '@supabase/supabase-js';

export interface UserTimingHistory {
  /** Per-tag average actual minutes and sample count. */
  tagStats: Record<string, { avgMinutes: number; count: number }>;
  /**
   * Up to 20 most-recently-completed tasks that had timer data.
   * Passed verbatim to the LLM so it can spot title-level similarities
   * (e.g. "lab report" → previous lab reports the user actually timed).
   */
  recentTasks: Array<{
    title: string;
    tag: string | null;
    estimatedMinutes: number;
    actualMinutes: number;
  }>;
}

/**
 * Fetches the user's historical timing data from completed tasks.
 * Returns empty history gracefully when no completed tasks exist yet.
 */
export async function fetchUserTimingHistory(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserTimingHistory> {
  const { data } = await supabase
    .from('tasks')
    .select('title, tag, estimated_minutes, actual_duration')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .not('actual_duration', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(50);

  if (!data || data.length === 0) {
    return { tagStats: {}, recentTasks: [] };
  }

  // Build per-tag minute buckets
  const tagBuckets: Record<string, number[]> = {};
  for (const row of data) {
    const tag = row.tag as string | null;
    const actualMinutes = Math.round((row.actual_duration as number) / 60);
    if (tag && actualMinutes > 0) {
      tagBuckets[tag] ??= [];
      tagBuckets[tag].push(actualMinutes);
    }
  }

  const tagStats: Record<string, { avgMinutes: number; count: number }> = {};
  for (const [tag, mins] of Object.entries(tagBuckets)) {
    const avg = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
    tagStats[tag] = { avgMinutes: avg, count: mins.length };
  }

  // Keep the 20 most recent for title-level matching
  const recentTasks = data.slice(0, 20).map((row) => ({
    title:            row.title as string,
    tag:              row.tag as string | null,
    estimatedMinutes: row.estimated_minutes as number,
    actualMinutes:    Math.round((row.actual_duration as number) / 60),
  }));

  return { tagStats, recentTasks };
}
