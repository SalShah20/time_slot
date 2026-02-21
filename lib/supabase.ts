import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Singleton — safe to import anywhere (client components, server components, API routes)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const PLACEHOLDER_USER_ID =
  process.env.NEXT_PUBLIC_PLACEHOLDER_USER_ID ?? '00000000-0000-0000-0000-000000000001';
