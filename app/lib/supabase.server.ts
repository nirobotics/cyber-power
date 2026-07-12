import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRequiredEnv } from "./auth.server";

let serviceClient: SupabaseClient | null = null;

export function getSupabaseServiceClient() {
  serviceClient ??= createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SECRET_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  return serviceClient;
}
