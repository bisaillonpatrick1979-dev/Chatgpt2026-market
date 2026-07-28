import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://samukekuucaibcxkvsff.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Wq_duRp9CUN6R3TfvTRA_w_KaVME41Y";

let browserClient: SupabaseClient | null = null;

function getSupabaseConfiguration() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL,
    publishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      DEFAULT_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function hasSupabaseEnvironment() {
  const { url, publishableKey } = getSupabaseConfiguration();
  return Boolean(url && publishableKey);
}

export function getSupabaseBrowserClient() {
  const { url, publishableKey } = getSupabaseConfiguration();

  if (!url || !publishableKey) {
    throw new Error("La configuration publique Supabase est absente.");
  }

  if (!browserClient) {
    browserClient = createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return browserClient;
}
