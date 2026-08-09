import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseCookieOptions } from "@/lib/supabase/cookie-options";
import type { Database } from "@/lib/supabase/database.types";

function getSupabaseBrowserEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing env.NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!supabasePublishableKey) {
    throw new Error("Missing env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }

  return { supabaseUrl, supabasePublishableKey };
}

export function createClient() {
  const { supabaseUrl, supabasePublishableKey } = getSupabaseBrowserEnv();
  const hostname =
    typeof window === "undefined" ? undefined : window.location.hostname;

  return createBrowserClient<Database>(supabaseUrl, supabasePublishableKey, {
    cookieOptions: getSupabaseCookieOptions(hostname),
  });
}
