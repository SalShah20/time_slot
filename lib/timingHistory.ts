import type { SupabaseClient } from '@supabase/supabase-js';

export interface UserTimingHistory {
  /** Per-tag average actual minutes and sample count. */
  tagStats: Record<string, { avgMinutes: number; count: number }>;
  /**
   * Per-tag difficulty bias: how often users rate tasks of this tag as harder/easier.
   * A positive multiplier (>1) means tasks tend to take longer than estimated.
   * Used to pad future estimates automatically.
   */
  tagDifficultyMultiplier: Record<string, number>;
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
    .select('title, tag, estimated_minutes, actual_duration, difficulty_rating')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .not('actual_duration', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(50);

  if (!data || data.length === 0) {
    return { tagStats: {}, tagDifficultyMultiplier: {}, recentTasks: [] };
  }

  // Build per-tag minute buckets and difficulty counts
  const tagBuckets: Record<string, number[]> = {};
  const tagDifficulty: Record<string, { harder: number; right: number; easy: number }> = {};
  for (const row of data) {
    const tag = row.tag as string | null;
    const actualMinutes = Math.round((row.actual_duration as number) / 60);
    if (tag && actualMinutes > 0) {
      tagBuckets[tag] ??= [];
      tagBuckets[tag].push(actualMinutes);
    }
    const rating = row.difficulty_rating as string | null;
    if (tag && rating && (rating === 'harder' || rating === 'right' || rating === 'easy')) {
      tagDifficulty[tag] ??= { harder: 0, right: 0, easy: 0 };
      tagDifficulty[tag][rating]++;
    }
  }

  const tagStats: Record<string, { avgMinutes: number; count: number }> = {};
  for (const [tag, mins] of Object.entries(tagBuckets)) {
    const avg = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
    tagStats[tag] = { avgMinutes: avg, count: mins.length };
  }

  // Compute per-tag difficulty multiplier:
  // If a tag is consistently rated "harder", pad future estimates by 15-20%.
  // If consistently "easy", reduce by 10-15%.
  const tagDifficultyMultiplier: Record<string, number> = {};
  for (const [tag, counts] of Object.entries(tagDifficulty)) {
    const total = counts.harder + counts.right + counts.easy;
    if (total < 2) continue; // not enough data
    // Weighted score: harder=+1, right=0, easy=-1
    const score = (counts.harder - counts.easy) / total; // range [-1, 1]
    // Map to multiplier: -1 → 0.85, 0 → 1.0, +1 → 1.20
    const multiplier = 1 + score * 0.20;
    // Only store if it's meaningfully different from 1.0
    if (Math.abs(multiplier - 1) > 0.04) {
      tagDifficultyMultiplier[tag] = Math.round(multiplier * 100) / 100;
    }
  }

  // Keep the 20 most recent for title-level matching
  const recentTasks = data.slice(0, 20).map((row) => ({
    title:            row.title as string,
    tag:              row.tag as string | null,
    estimatedMinutes: row.estimated_minutes as number,
    actualMinutes:    Math.round((row.actual_duration as number) / 60),
  }));

  return { tagStats, tagDifficultyMultiplier, recentTasks };
}
