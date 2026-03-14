import type { SupabaseClient } from '@supabase/supabase-js';

/** Returns true if the user has the is_premium flag set. */
export async function checkPremium(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('user_tokens')
    .select('is_premium')
    .eq('user_id', userId)
    .single();
  return !!(data as { is_premium?: boolean } | null)?.is_premium;
}
