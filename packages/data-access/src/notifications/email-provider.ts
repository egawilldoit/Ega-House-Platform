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
        return { ok: false, errorCode: classifyEmailError(result.error), errorReason: reason };
      }

      return { ok: true, providerMessageId: result.data?.id ?? undefined };
    } catch (error) {
      const reason = stringifyError(error);
      return { ok: false, errorCode: classifyEmailError(error), errorReason: reason };
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

function readStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  for (const key of ["statusCode", "status", "httpStatus"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  }
  return null;
}

/**
 * Classify a Resend failure from its structured HTTP status when available.
 * Message-only heuristics are a fallback; never retry a permanent 4xx just
 * because its text happens to contain a digit.
 */
function classifyEmailError(error: unknown): "transient" | "permanent" {
  const status = readStatus(error);
  if (status !== null) {
    if (status === 408 || status === 429 || (status >= 500 && status <= 599)) return "transient";
    if (status >= 400 && status < 500) return "permanent";
  }

  const text = stringifyError(error).toLowerCase();
  if (
    /(rate|too many|timeout|timed out|econn|etimedout|enotfound|network|fetch failed|unavailable|internal server)/.test(
      text,
    )
  ) {
    return "transient";
  }
  if (/(invalid|validation|not found|forbidden|unauthorized|bad request|unprocessable)/.test(text)) {
    return "permanent";
  }

  // Unknown provider errors get the bounded retry budget rather than a false
  // terminal outcome.
  return "transient";
}

export class SupabaseEmailResolver implements EmailDestinationResolver {
  constructor(private readonly supabase: import("@supabase/supabase-js").SupabaseClient) {}

  async resolve(ownerUserId: string): Promise<string | null> {
    // The canonical owner email lives in Supabase Auth. The cron uses a service
    // client, so resolve by the owner id from the delivery. Never use the
    // session-bound getUser(): it resolves the service identity, not the owner.
    try {
      const admin = (this.supabase as unknown as {
        auth?: {
          admin?: {
            getUserById?: (id: string) => Promise<{
              data?: { user?: { email?: string | null } | null } | null;
              error?: unknown;
            }>;
          };
        };
      }).auth?.admin;
      if (admin?.getUserById) {
        const { data, error } = await admin.getUserById(ownerUserId);
        if (!error) {
          const email = data?.user?.email;
          if (typeof email === "string" && email.trim()) return email.trim();
        }
      }
    } catch {
      // fall through to the legacy profiles path
    }

    // Compatibility fallback for deployments that still expose an owner-scoped
    // profiles.email row. The lookup is by the owner id from the delivery.
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

    return null;
  }
}
