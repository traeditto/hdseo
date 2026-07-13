import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env, hasSupabaseAdminConfig } from "@/lib/config/env";

export function createSupabaseAdminClient() {
  if (!hasSupabaseAdminConfig) return null;
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}
