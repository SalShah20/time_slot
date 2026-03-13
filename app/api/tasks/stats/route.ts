import { NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();

  // ── Core stats ────────────────────────────────────────────────────────────
  const { data, error } = await supabase
    .from('tasks')
    .select('status')
    .eq('user_id', user.id)
    .neq('status', 'cancelled')
    .is('parent_task_id', null);

  if (error) {
    console.error('[GET /api/tasks/stats]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total     = data.length;
  const upcoming  = data.filter((t) => t.status === 'pending' || t.status === 'in_progress').length;
  const completed = data.filter((t) => t.status === 'completed').length;

  // ── Productivity insights (last 7 days, non-fatal) ────────────────────────
  let avgAccuracy: number | null = null;
  let mostProductiveTag: string | null = null;
  let mostProductiveMinutes: number | null = null;

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();

    const { data: recentCompleted } = await supabase
      .from('tasks')
      .select('tag, estimated_minutes, actual_duration')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .not('actual_duration', 'is', null)
      .gte('updated_at', sevenDaysAgo);

    if (recentCompleted && recentCompleted.length >= 5) {
      // Average estimation accuracy: estimated / actual (1.0 = perfect)
      const accuracies = recentCompleted
        .filter((t) => (t.actual_duration as number) > 0 && (t.estimated_minutes as number) > 0)
        .map((t) => {
          const actualMinutes = (t.actual_duration as number) / 60;
          return (t.estimated_minutes as number) / actualMinutes;
        });

      if (accuracies.length >= 5) {
        avgAccuracy = Math.round((accuracies.reduce((a, b) => a + b, 0) / accuracies.length) * 100) / 100;
      }

      // Most productive tag: highest total actual work minutes this week
      const tagTotals: Record<string, number> = {};
      for (const t of recentCompleted) {
        const tag = t.tag as string | null;
        if (!tag) continue;
        const actualMinutes = Math.round((t.actual_duration as number) / 60);
        tagTotals[tag] = (tagTotals[tag] ?? 0) + actualMinutes;
      }

      let maxMinutes = 0;
      for (const [tag, minutes] of Object.entries(tagTotals)) {
        if (minutes > maxMinutes) {
          maxMinutes = minutes;
          mostProductiveTag = tag;
          mostProductiveMinutes = minutes;
        }
      }
    }
  } catch (err) {
    console.warn('[GET /api/tasks/stats] Insights query failed (non-fatal):', err);
  }

  return NextResponse.json({
    total,
    upcoming,
    completed,
    avgAccuracy,
    mostProductiveTag,
    mostProductiveMinutes,
  });
}
