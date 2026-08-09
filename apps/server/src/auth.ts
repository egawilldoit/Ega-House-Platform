import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Extract the bearer token from an Authorization header value.
 *
 * Returns null when the header is missing, uses a scheme other than Bearer,
 * or carries an empty token. Identity is NEVER taken from a JSON body, URL,
 * query string, or custom user-id header — the bearer header is the only
 * accepted identity channel.
 */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Verify a Supabase access token server-side and return the verified user id.
 *
 * Uses the standard `auth.getUser(jwt)` endpoint with the anon/publishable
 * client key. Returns null when the token is missing, expired, revoked, or
 * otherwise invalid — callers must treat null as unauthenticated.
 */
export async function verifyAccessToken(
  client: SupabaseClient,
  token: string,
): Promise<string | null> {
  const { data, error } = await client.auth.getUser(token);

  if (error || !data.user?.id) {
    return null;
  }

  return data.user.id;
}

/**
 * Build the request-scoped Supabase client that carries the SAME verified
 * access token on every PostgREST call, so RLS evaluates as that user.
 *
 * Normal product requests must never use a service-role client or a
 * privileged raw database connection as an authorization shortcut.
 */
export function createAuthenticatedClient(
  url: string,
  anonKey: string,
  token: string,
): SupabaseClient {
  return createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}
