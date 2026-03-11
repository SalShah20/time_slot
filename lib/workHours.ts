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

/** Format a 24h hour value for display in an LLM prompt (e.g. 8 → "8 AM", 23 → "11 PM"). */
export function formatHourForPrompt(h: number): string {
  if (h === 0 || h === 24) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}
