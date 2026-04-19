import type { Session, User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export class AuthServiceError extends Error {
  readonly code: "UNAUTHENTICATED";

  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthServiceError";
    this.code = "UNAUTHENTICATED";
  }
}

type AuthServiceOptions = {
  supabase?: SupabaseServerClient;
};

async function resolveSupabaseClient(options?: AuthServiceOptions) {
  if (options?.supabase) {
    return options.supabase;
  }

  return createClient();
}

export async function getCurrentUser(options?: AuthServiceOptions): Promise<User | null> {
  const supabase = await resolveSupabaseClient(options);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function getCurrentSession(
  options?: AuthServiceOptions,
): Promise<Session | null> {
  const supabase = await resolveSupabaseClient(options);
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session;
}

export async function requireAuthenticatedUser(options?: AuthServiceOptions): Promise<User> {
  const user = await getCurrentUser(options);

  if (!user) {
    throw new AuthServiceError();
  }

  return user;
}

export function isAuthServiceError(error: unknown): error is AuthServiceError {
  return error instanceof AuthServiceError;
}
