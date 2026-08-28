import type {
  EmailDestinationResolver,
  EmailProvider,
  EmailProviderPayload,
  EmailProviderResult,
} from "@ega/application/notifications/ports";

type ResendLikeClient = {
  emails: {
    send(input: { from: string; to: string; subject: string; html: string }): Promise<{
      data?: { id?: string } | null;
      error?: unknown;
    }>;
  };
};

export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly resend: ResendLikeClient,
    private readonly from: string,
  ) {}

  async send(payload: EmailProviderPayload): Promise<EmailProviderResult> {
    try {
      const result = await this.resend.emails.send({
        from: this.from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
      });

      if (result.error) {
        const reason = stringifyError(result.error);
        const code = isTransientEmailError(reason) ? "transient" : "permanent";
        return { ok: false, errorCode: code, errorReason: reason };
      }

      return { ok: true, providerMessageId: result.data?.id ?? undefined };
    } catch (error) {
      const reason = stringifyError(error);
      const code = isTransientEmailError(reason) ? "transient" : "permanent";
      return { ok: false, errorCode: code, errorReason: reason };
    }
  }
}

function stringifyError(error: unknown): string {
  if (!error) return "Unknown email error";
  if (error instanceof Error) return error.message.slice(0, 500);
  if (typeof error === "string") return error.slice(0, 500);
  try {
    return JSON.stringify(error).slice(0, 500);
  } catch {
    return "Unknown email error";
  }
}

function isTransientEmailError(reason: string): boolean {
  const lower = reason.toLowerCase();
  return lower.includes("rate") || lower.includes("429") || lower.includes("timeout") || lower.includes("econn") || lower.includes("5");
}

export class SupabaseEmailResolver implements EmailDestinationResolver {
  constructor(private readonly supabase: import("@supabase/supabase-js").SupabaseClient) {}

  async resolve(ownerUserId: string): Promise<string | null> {
    // Try to resolve via Supabase auth admin? For V1, use service's user email if available via a narrow query.
    // Since we don't have direct auth email in app tables, query auth.users via service? Fallback: use ownerUserId as placeholder?
    // Instead, attempt to fetch from a user_profiles table if exists, else null.
    // For now, try to fetch via supabase.auth.getUser? But data-access shouldn't need service role.
    // We'll try an RPC or a simple query to a profiles table; if not found, return null.
    // The caller (server cron) can provide a direct email via env for system tasks; for now we implement a minimal stub that
    // queries a potential 'profiles' or uses supabase auth admin via service client if provided.

    // Attempt to query via supabase.from('profiles') if exists
    try {
      const result = await (this.supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (col: string, val: string) => {
              maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
            };
          };
        };
      })
        .from("profiles")
        .select("email")
        .eq("id", ownerUserId)
        .maybeSingle();

      if (!result.error && result.data) {
        const row = result.data as { email?: string | null };
        if (row.email) return row.email;
      }
    } catch {
      // ignore
    }

    // Fallback: try auth.getUser if supabase has auth
    try {
      const authClient = this.supabase.auth as unknown as {
        getUser: () => Promise<{ data: { user?: { email?: string | null } | null }; error: unknown }>;
      };
      if (authClient?.getUser) {
        const { data, error } = await authClient.getUser();
        if (!error && data.user?.email) return data.user.email;
      }
    } catch {
      // ignore
    }

    return null;
  }
}
