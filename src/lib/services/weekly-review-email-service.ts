import { buildWeeklyReviewEmail, type WeeklyReviewEmailRecord } from "@/lib/email/weekly-review-preview";
import { getWeekBounds } from "@/lib/review-week";
import { generateWeeklyReviewDraftForUser } from "@/lib/services/weekly-review-draft-service";

export type WeeklyReviewOfficialEmailStatus = "processing" | "sent" | "failed" | null;

export type WeeklyReviewOfficialEmailRecord = WeeklyReviewEmailRecord & {
  ownerUserId: string;
  officialEmailStatus: WeeklyReviewOfficialEmailStatus;
  officialEmailSentAt: string | null;
};

export type WeeklyReviewEmailCounts = {
  generated: number;
  sent: number;
  skipped: number;
  failed: number;
};

export type WeeklyReviewEmailLog = {
  ownerUserId: string;
  reviewId?: string;
  status: "generated" | "sent" | "skipped" | "failed";
  reason?: string;
  messageId?: string | null;
};

export type WeeklyReviewEmailJobResult = {
  ok: true;
  weekStart: string;
  weekEnd: string;
  counts: WeeklyReviewEmailCounts;
  logs: WeeklyReviewEmailLog[];
};

type ResendEmailClient = {
  emails: {
    send(input: {
      from: string;
      to: string;
      subject: string;
      html: string;
    }): Promise<{ data?: { id?: string } | null; error?: unknown }>;
  };
};

type WeeklyReviewEmailSupabaseClient = {
  from(table: string): WeeklyReviewEmailTable;
};

type WeeklyReviewEmailTable = {
  select(columns: string): WeeklyReviewEmailQuery;
  upsert(payload: Record<string, unknown>, options: { onConflict: string }): WeeklyReviewEmailQuery;
  update(payload: Record<string, unknown>): WeeklyReviewEmailQuery;
};

type WeeklyReviewEmailQuery = WeeklyReviewEmailTable & {
  eq(column: string, value: string): WeeklyReviewEmailQuery;
  is(column: string, value: null): WeeklyReviewEmailQuery;
  or(expression: string): WeeklyReviewEmailQuery;
  order(column: string, options?: { ascending?: boolean }): WeeklyReviewEmailQuery;
  limit(count: number): WeeklyReviewEmailQuery;
  maybeSingle(): PromiseLike<{ data: WeeklyReviewEmailRow | null; error: { message: string } | null }>;
  single(): PromiseLike<{ data: WeeklyReviewEmailRow; error: { message: string } | null }>;
};

type WeeklyReviewEmailRow = {
  id: string;
  owner_user_id: string;
  week_start: string;
  week_end: string;
  summary: string | null;
  wins: string | null;
  blockers: string | null;
  next_steps: string | null;
  official_email_status: WeeklyReviewOfficialEmailStatus;
  official_email_sent_at: string | null;
};

export type DeliverWeeklyReviewEmailsOptions = {
  ownerUserIds: string[];
  loadReview(input: {
    ownerUserId: string;
    weekStart: string;
    weekEnd: string;
  }): Promise<WeeklyReviewOfficialEmailRecord | null>;
  generateAndSaveReview(input: {
    ownerUserId: string;
    weekStart: string;
    weekEnd: string;
    now: Date;
  }): Promise<WeeklyReviewOfficialEmailRecord>;
  claimReviewForOfficialSend(input: {
    reviewId: string;
    ownerUserId: string;
    weekStart: string;
    now: Date;
  }): Promise<WeeklyReviewOfficialEmailRecord | null>;
  markReviewOfficialEmailSent(input: {
    reviewId: string;
    messageId: string | null;
    now: Date;
  }): Promise<void>;
  markReviewOfficialEmailFailed(input: {
    reviewId: string;
    reason: string;
    now: Date;
  }): Promise<void>;
  resend: ResendEmailClient;
  from: string;
  to: string;
  appUrl?: string;
  now?: Date;
  weekStart?: string;
  weekEnd?: string;
};

const WEEK_REVIEW_SELECT =
  "id, owner_user_id, week_start, week_end, summary, wins, blockers, next_steps, official_email_status, official_email_sent_at";

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizeOwnerUserIds(ownerUserIds: string[]) {
  return Array.from(new Set(ownerUserIds.map((id) => id.trim()).filter(Boolean)));
}

function mapReviewRecord(row: WeeklyReviewEmailRow): WeeklyReviewOfficialEmailRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    summary: row.summary,
    wins: row.wins,
    blockers: row.blockers,
    nextSteps: row.next_steps,
    officialEmailStatus: row.official_email_status,
    officialEmailSentAt: row.official_email_sent_at,
  };
}

function summarizeError(error: unknown) {
  if (!error) {
    return "Unknown weekly review email delivery error.";
  }
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }
  if (typeof error === "string") {
    return error.slice(0, 500);
  }
  try {
    return JSON.stringify(error).slice(0, 500);
  } catch {
    return "Unknown weekly review email delivery error.";
  }
}

export function getWeeklyReviewEmailTargetWeek(now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceSunday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - daysSinceSunday);
  const bounds = getWeekBounds(toIsoDate(date));

  if (!bounds) {
    throw new Error("Failed to resolve weekly review email target week.");
  }

  return bounds;
}

export async function deliverWeeklyReviewEmails(
  options: DeliverWeeklyReviewEmailsOptions,
): Promise<WeeklyReviewEmailJobResult> {
  const now = options.now ?? new Date();
  const targetWeek =
    options.weekStart && options.weekEnd
      ? { weekStart: options.weekStart, weekEnd: options.weekEnd }
      : getWeeklyReviewEmailTargetWeek(now);
  const counts: WeeklyReviewEmailCounts = { generated: 0, sent: 0, skipped: 0, failed: 0 };
  const logs: WeeklyReviewEmailLog[] = [];

  for (const ownerUserId of normalizeOwnerUserIds(options.ownerUserIds)) {
    try {
      let review = await options.loadReview({
        ownerUserId,
        weekStart: targetWeek.weekStart,
        weekEnd: targetWeek.weekEnd,
      });

      if (review?.officialEmailSentAt || review?.officialEmailStatus === "sent") {
        counts.skipped += 1;
        logs.push({
          ownerUserId,
          reviewId: review.id,
          status: "skipped",
          reason: "official weekly review email already sent",
        });
        continue;
      }

      if (!review) {
        review = await options.generateAndSaveReview({
          ownerUserId,
          weekStart: targetWeek.weekStart,
          weekEnd: targetWeek.weekEnd,
          now,
        });
        counts.generated += 1;
        logs.push({ ownerUserId, reviewId: review.id, status: "generated" });
      }

      const claimedReview = await options.claimReviewForOfficialSend({
        reviewId: review.id,
        ownerUserId,
        weekStart: targetWeek.weekStart,
        now,
      });

      if (!claimedReview) {
        counts.skipped += 1;
        logs.push({
          ownerUserId,
          reviewId: review.id,
          status: "skipped",
          reason: "official send already claimed or sent",
        });
        continue;
      }

      const email = buildWeeklyReviewEmail(claimedReview, options.appUrl, "official");
      let sendError: unknown = null;
      let messageId: string | null = null;

      try {
        const sendResult = await options.resend.emails.send({
          from: options.from,
          to: options.to,
          subject: email.subject,
          html: email.html,
        });
        sendError = sendResult.error ?? null;
        messageId = sendResult.data?.id ?? null;
      } catch (error) {
        sendError = error;
      }

      if (sendError) {
        const reason = summarizeError(sendError);
        await options.markReviewOfficialEmailFailed({ reviewId: claimedReview.id, reason, now });
        counts.failed += 1;
        logs.push({ ownerUserId, reviewId: claimedReview.id, status: "failed", reason });
        continue;
      }

      await options.markReviewOfficialEmailSent({ reviewId: claimedReview.id, messageId, now });
      counts.sent += 1;
      logs.push({ ownerUserId, reviewId: claimedReview.id, status: "sent", messageId });
    } catch (error) {
      counts.failed += 1;
      logs.push({ ownerUserId, status: "failed", reason: summarizeError(error) });
    }
  }

  return { ok: true, ...targetWeek, counts, logs };
}

export function createWeeklyReviewEmailSupabaseAdapter(supabase: WeeklyReviewEmailSupabaseClient) {
  return {
    async loadReview({
      ownerUserId,
      weekStart,
      weekEnd,
    }: {
      ownerUserId: string;
      weekStart: string;
      weekEnd: string;
    }) {
      const { data, error } = await supabase
        .from("week_reviews")
        .select(WEEK_REVIEW_SELECT)
        .eq("owner_user_id", ownerUserId)
        .eq("week_start", weekStart)
        .eq("week_end", weekEnd)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to load weekly review email record: ${error.message}`);
      }

      return data ? mapReviewRecord(data) : null;
    },
    async generateAndSaveReview({
      ownerUserId,
      weekStart,
      weekEnd,
      now,
    }: {
      ownerUserId: string;
      weekStart: string;
      weekEnd: string;
      now: Date;
    }) {
      const draft = await generateWeeklyReviewDraftForUser({
        supabase,
        ownerUserId,
        weekStart,
        weekEnd,
        now,
      });
      const nowIso = now.toISOString();
      const { data, error } = await supabase
        .from("week_reviews")
        .upsert(
          {
            owner_user_id: ownerUserId,
            week_start: weekStart,
            week_end: weekEnd,
            summary: draft.summary,
            wins: draft.wins,
            blockers: draft.blockers,
            next_steps: draft.nextSteps,
            updated_at: nowIso,
          },
          { onConflict: "owner_user_id,week_start" },
        )
        .select(WEEK_REVIEW_SELECT)
        .single();

      if (error) {
        throw new Error(`Failed to save generated weekly review email record: ${error.message}`);
      }

      return mapReviewRecord(data);
    },
    async claimReviewForOfficialSend({
      reviewId,
      ownerUserId,
      weekStart,
      now,
    }: {
      reviewId: string;
      ownerUserId: string;
      weekStart: string;
      now: Date;
    }) {
      const nowIso = now.toISOString();
      const { data, error } = await supabase
        .from("week_reviews")
        .update({
          official_email_status: "processing",
          official_email_claimed_at: nowIso,
          official_email_failure_reason: null,
          updated_at: nowIso,
        })
        .eq("id", reviewId)
        .eq("owner_user_id", ownerUserId)
        .eq("week_start", weekStart)
        .is("official_email_sent_at", null)
        .or("official_email_status.is.null,official_email_status.eq.failed")
        .select(WEEK_REVIEW_SELECT)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to claim weekly review official email: ${error.message}`);
      }

      return data ? mapReviewRecord(data) : null;
    },
    async markReviewOfficialEmailSent({
      reviewId,
      messageId,
      now,
    }: {
      reviewId: string;
      messageId: string | null;
      now: Date;
    }) {
      const nowIso = now.toISOString();
      const { error } = await supabase
        .from("week_reviews")
        .update({
          official_email_status: "sent",
          official_email_sent_at: nowIso,
          official_email_message_id: messageId,
          official_email_failure_reason: null,
          updated_at: nowIso,
        })
        .eq("id", reviewId)
        .eq("official_email_status", "processing")
        .select("id")
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to mark weekly review official email sent: ${error.message}`);
      }
    },
    async markReviewOfficialEmailFailed({
      reviewId,
      reason,
      now,
    }: {
      reviewId: string;
      reason: string;
      now: Date;
    }) {
      const nowIso = now.toISOString();
      const { error } = await supabase
        .from("week_reviews")
        .update({
          official_email_status: "failed",
          official_email_failure_reason: reason,
          updated_at: nowIso,
        })
        .eq("id", reviewId)
        .eq("official_email_status", "processing")
        .select("id")
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to mark weekly review official email failed: ${error.message}`);
      }
    },
  };
}
