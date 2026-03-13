import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkHours } from '@/lib/scheduleUtils';
import { DEFAULT_WORK_HOURS } from '@/lib/scheduleUtils';

/** Fetch the user's working hours from user_tokens, falling back to defaults. */
export async function fetchWorkHours(supabase: SupabaseClient, userId: string): Promise<WorkHours> {
  const { data } = await supabase
    .from('user_tokens')
    .select('work_start_hour, work_end_hour, work_end_late_hour')
    .eq('user_id', userId)
    .single();

  if (!data) return DEFAULT_WORK_HOURS;

  return {
    workStartHour: data.work_start_hour ?? DEFAULT_WORK_HOURS.workStartHour,
    workEndHour: data.work_end_hour ?? DEFAULT_WORK_HOURS.workEndHour,
    workEndLateHour: data.work_end_late_hour ?? DEFAULT_WORK_HOURS.workEndLateHour,
  };
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
