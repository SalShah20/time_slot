import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkHours } from '@/lib/scheduleUtils';
import { DEFAULT_WORK_HOURS } from '@/lib/scheduleUtils';

/** Fetch the user's working hours from user_tokens, falling back to defaults. */
export async function fetchWorkHours(supabase: SupabaseClient, userId: string): Promise<WorkHours> {
  const { data } = await supabase
    .from('user_tokens')
    .select('work_start_hour, work_end_hour, work_end_late_hour, prefer_mornings, prefer_evenings, avoid_back_to_back, work_hours_by_day')
    .eq('user_id', userId)
    .single();

  if (!data) return DEFAULT_WORK_HOURS;

  const row = data as Record<string, unknown>;

  const wh: WorkHours = {
    workStartHour:   (row.work_start_hour as number) ?? DEFAULT_WORK_HOURS.workStartHour,
    workEndHour:     (row.work_end_hour as number) ?? DEFAULT_WORK_HOURS.workEndHour,
    workEndLateHour: (row.work_end_late_hour as number) ?? DEFAULT_WORK_HOURS.workEndLateHour,
    preferMornings:  (row.prefer_mornings as boolean) ?? false,
    preferEvenings:  (row.prefer_evenings as boolean) ?? false,
    avoidBackToBack: (row.avoid_back_to_back as boolean) ?? false,
  };

  if (row.work_hours_by_day && typeof row.work_hours_by_day === 'object') {
    wh.byDay = row.work_hours_by_day as Record<string, { workStartHour?: number; workEndHour?: number; workEndLateHour?: number }>;
  }

  return wh;
}

/** Fetch the user's stored timezone, falling back to null. */
export async function fetchUserTimezone(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('user_tokens')
    .select('work_timezone')
    .eq('user_id', userId)
    .single();

  return data?.work_timezone ?? null;
}

/** Format a decimal hour value for display in an LLM prompt (e.g. 8 → "8 AM", 23.5 → "11:30 PM", 24 → "12 AM"). */
export function formatHourForPrompt(h: number): string {
  const hour = Math.floor(h) % 24;
  const min = Math.round((h - Math.floor(h)) * 60);
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  if (min === 0) return `${h12} ${suffix}`;
  return `${h12}:${min.toString().padStart(2, '0')} ${suffix}`;
}
