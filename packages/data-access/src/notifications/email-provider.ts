import type {
  EmailDestinationResolution,
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

/**
 * A permanent invalid-owner response is genuine absence, not a transient
 * provider outage. Do not retry it through the email delivery budget.
 */
function isPermanentOwnerLookupFailure(error: unknown): boolean {
  const status = readStatus(error);
  if (status !== null) {
    if (status === 400 || status === 404 || status === 422) return true;
    return false;
  }

  const text = stringifyError(error).toLowerCase();
  return /user not found|user_not_found|invalid user|invalid owner|not found/.test(text);
}

export class SupabaseEmailResolver implements EmailDestinationResolver {
  constructor(private readonly supabase: import("@supabase/supabase-js").SupabaseClient) {}

  async resolve(ownerUserId: string): Promise<EmailDestinationResolution> {
    // The canonical owner email lives in Supabase Auth. The cron uses a service
    // client, so resolve by the owner id from the delivery. Never use the
    // session-bound getUser(): it resolves the service identity, not the owner.
    let adminOutcome: "absent" | "unavailable" = "unavailable";
    let adminReason = "Supabase Auth admin lookup is unavailable.";

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
      try {
        const { data, error } = await admin.getUserById(ownerUserId);
        if (!error) {
          const email = data?.user?.email;
          if (typeof email === "string" && email.trim()) {
            return { status: "resolved", email: email.trim() };
          }
          adminOutcome = "absent";
        } else if (isPermanentOwnerLookupFailure(error)) {
          adminOutcome = "absent";
          adminReason = "Owner account was not found.";
        } else {
          adminReason = "Supabase Auth admin lookup failed.";
        }
      } catch {
        adminReason = "Supabase Auth admin lookup failed.";
      }
    }

    // Compatibility fallback for deployments that still expose an owner-scoped
    // profiles.email row. A missing/erroring fallback is not proof of absence;
    // the authoritative admin outcome decides that.
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
        if (typeof row.email === "string" && row.email.trim()) {
          return { status: "resolved", email: row.email.trim() };
        }
      }
    } catch {
      // fallback unavailable; admin outcome remains authoritative
    }

    if (adminOutcome === "absent") return { status: "absent" };
    return { status: "unavailable", reason: adminReason };
  }
}
