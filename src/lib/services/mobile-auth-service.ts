import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import {
  mapUserToMobileAuthenticatedUser,
  type MobileAuthSessionResponse,
  type MobileAuthRefreshResponse,
  type MobileSessionPayload,
} from "@/lib/contracts/mobile";

type ServiceSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

function getSupabaseEnv(
  name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing env.${name}`);
  }

  return value;
}

function mapSessionPayload(session: {
  access_token: string;
  refresh_token: string;
  expires_at?: number | null;
  expires_in?: number | null;
}): MobileSessionPayload {
  const fallbackExpiresAt =
    Math.floor(Date.now() / 1000) + Math.max(0, session.expires_in ?? 3600);

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? fallbackExpiresAt,
  };
}

function createStatelessSupabaseClient(accessToken?: string) {
  const supabaseUrl = getSupabaseEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabasePublishableKey = getSupabaseEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  return createSupabaseClient<Database>(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  });
}

export async function createMobileScopedSupabaseClient(accessToken: string) {
  const supabase = createStatelessSupabaseClient(accessToken);
  return supabase as unknown as ServiceSupabaseClient;
}

export async function signInMobileWithPassword(email: string, password: string) {
  const supabase = createStatelessSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user || !data.session) {
    return {
      errorCode: "INVALID_CREDENTIALS" as const,
      errorMessage: "Invalid email or password.",
      status: 401,
    };
  }

  const response: MobileAuthSessionResponse = {
    ok: true,
    user: mapUserToMobileAuthenticatedUser(data.user),
    session: mapSessionPayload(data.session),
  };

  return {
    errorCode: null,
    errorMessage: null,
    status: 200,
    data: response,
  };
}

export async function refreshMobileSession(refreshToken: string) {
  const supabase = createStatelessSupabaseClient();
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error || !data.session) {
    return {
      errorCode: "SESSION_EXPIRED" as const,
      errorMessage: "Refresh token is invalid or expired.",
      status: 401,
    };
  }

  const response: MobileAuthRefreshResponse = {
    ok: true,
    session: mapSessionPayload(data.session),
    user: data.user ? mapUserToMobileAuthenticatedUser(data.user) : undefined,
  };

  return {
    errorCode: null,
    errorMessage: null,
    status: 200,
    data: response,
  };
}

export async function resolveMobileUserFromAccessToken(accessToken: string) {
  const supabase = createStatelessSupabaseClient(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user) {
    return {
      errorCode: "UNAUTHENTICATED" as const,
      errorMessage: "Invalid or expired access token.",
      status: 401,
      user: null,
    };
  }

  return {
    errorCode: null,
    errorMessage: null,
    status: 200,
    user: data.user,
  };
}

export async function logoutMobileSession(accessToken: string) {
  const userResult = await resolveMobileUserFromAccessToken(accessToken);
  if (userResult.errorCode) {
    return userResult;
  }

  const supabase = createStatelessSupabaseClient(accessToken);
  await supabase.auth.signOut();

  return {
    errorCode: null,
    errorMessage: null,
    status: 200,
  };
}
