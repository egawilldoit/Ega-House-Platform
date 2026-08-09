import type { User } from "@supabase/supabase-js";

import { createMobileScopedSupabaseClient, resolveMobileUserFromAccessToken } from "@/lib/services/mobile-auth-service";
import { getBearerTokenFromRequest } from "@/lib/validation/mobile";
import type { createClient as createServerSupabaseClient } from "@/lib/supabase/server";

type ServiceSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export async function resolveMobileRequestAuth(request: Request): Promise<
  | {
      ok: true;
      accessToken: string;
      user: User;
      supabase: ServiceSupabaseClient;
    }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "INTERNAL_ERROR";
      message: string;
      status: number;
    }
> {
  const accessToken = getBearerTokenFromRequest(request);
  if (!accessToken) {
    return {
      ok: false,
      code: "UNAUTHENTICATED",
      message: "Missing bearer token.",
      status: 401,
    };
  }

  const userResult = await resolveMobileUserFromAccessToken(accessToken);
  if (userResult.errorCode || !userResult.user) {
    return {
      ok: false,
      code: "UNAUTHENTICATED",
      message: userResult.errorMessage ?? "Invalid or expired access token.",
      status: userResult.status ?? 401,
    };
  }

  const supabase = await createMobileScopedSupabaseClient(accessToken);
  return {
    ok: true,
    accessToken,
    user: userResult.user,
    supabase,
  };
}
