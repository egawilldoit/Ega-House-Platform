export type SupabaseEnv = {
  url: string;
  anonKey: string;
};

/**
 * Resolve the Supabase project credentials the standalone server needs.
 *
 * Preferred names: `SUPABASE_URL` and `SUPABASE_ANON_KEY`. As a fallback the
 * web-facing `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
 * pair is accepted so a deployment that already injects those values can run
 * the server without additional secrets.
 *
 * Env vars are read at runtime (server start), never baked into the build.
 */
export function getSupabaseEnv(): SupabaseEnv {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url) {
    throw new Error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) env var.");
  }

  if (!anonKey) {
    throw new Error("Missing SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) env var.");
  }

  return { url, anonKey };
}
