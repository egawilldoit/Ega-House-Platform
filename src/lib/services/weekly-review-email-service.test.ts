import assert from "node:assert/strict";
import test from "node:test";

import {
  deliverWeeklyReviewEmails,
  getWeeklyReviewEmailTargetWeek,
  type WeeklyReviewOfficialEmailRecord,
} from "./weekly-review-email-service";

const now = new Date("2026-05-03T23:00:00.000Z");
const baseReview: WeeklyReviewOfficialEmailRecord = {
  id: "review-1",
  ownerUserId: "user-1",
  weekStart: "2026-04-27",
  weekEnd: "2026-05-03",
  summary: "Weekly Summary\nSaved canonical content",
  wins: "Wins\n- Existing win",
  blockers: "Main Blockers\n- None",
  nextSteps: "Suggested Next Steps\n- Continue",
  officialEmailStatus: null,
  officialEmailSentAt: null,
};

function createJobMock(options?: {
  initialReview?: WeeklyReviewOfficialEmailRecord | null;
  claimResult?: WeeklyReviewOfficialEmailRecord | null;
  sendError?: unknown;
  throwSendError?: unknown;
}) {
  let review = options?.initialReview === undefined ? { ...baseReview } : options.initialReview;
  const calls = {
    generated: 0,
    claimed: 0,
    markedSent: 0,
    markedFailed: 0,
  };
  const sentMessages: Array<{ from: string; to: string; subject: string; html: string }> = [];

  return {
    calls,
    sentMessages,
    options: {
      ownerUserIds: ["user-1"],
      from: "EGA <noreply@example.com>",
      to: "owner@example.com",
      appUrl: "https://app.example.com",
      now,
      async loadReview() {
        return review ? { ...review } : null;
      },
      async generateAndSaveReview(input: {
        ownerUserId: string;
        weekStart: string;
        weekEnd: string;
      }) {
        calls.generated += 1;
        review = {
          ...baseReview,
          id: "generated-review",
          ownerUserId: input.ownerUserId,
          weekStart: input.weekStart,
          weekEnd: input.weekEnd,
          summary: "Weekly Summary\nGenerated deterministic draft",
        };
        return { ...review };
      },
      async claimReviewForOfficialSend() {
        calls.claimed += 1;
        if (options?.claimResult !== undefined) {
          return options.claimResult ? { ...options.claimResult } : null;
        }
        return review ? { ...review, officialEmailStatus: "processing" as const } : null;
      },
      async markReviewOfficialEmailSent() {
        calls.markedSent += 1;
        if (review) {
          review = {
            ...review,
            officialEmailStatus: "sent",
            officialEmailSentAt: now.toISOString(),
          };
        }
      },
      async markReviewOfficialEmailFailed() {
        calls.markedFailed += 1;
        if (review) {
          review = { ...review, officialEmailStatus: "failed" };
        }
      },
      resend: {
        emails: {
          async send(input: { from: string; to: string; subject: string; html: string }) {
            sentMessages.push(input);
            if (options?.throwSendError) {
              throw options.throwSendError;
            }
            if (options?.sendError) {
              return { data: null, error: options.sendError };
            }
            return { data: { id: "email-1" }, error: null };
          },
        },
      },
    },
  };
}

test("weekly review email target is most recent Sunday-ending review week", () => {
  assert.deepEqual(getWeeklyReviewEmailTargetWeek(new Date("2026-05-03T23:00:00.000Z")), {
    weekStart: "2026-04-27",
    weekEnd: "2026-05-03",
  });
  assert.deepEqual(getWeeklyReviewEmailTargetWeek(new Date("2026-05-04T02:00:00.000Z")), {
    weekStart: "2026-04-27",
    weekEnd: "2026-05-03",
  });
});

test("sends latest existing saved review once", async () => {
  const mock = createJobMock();
  const result = await deliverWeeklyReviewEmails(mock.options);

  assert.deepEqual(result.counts, { generated: 0, sent: 1, skipped: 0, failed: 0 });
  assert.equal(mock.calls.generated, 0);
  assert.equal(mock.calls.claimed, 1);
  assert.equal(mock.calls.markedSent, 1);
  assert.equal(mock.sentMessages.length, 1);
  assert.match(mock.sentMessages[0].html, /Saved canonical content/);
  assert.match(mock.sentMessages[0].html, /Official weekly review sent by EGA House/);
});

test("generates and saves canonical review before send when missing", async () => {
  const mock = createJobMock({ initialReview: null });
  const result = await deliverWeeklyReviewEmails(mock.options);

  assert.deepEqual(result.counts, { generated: 1, sent: 1, skipped: 0, failed: 0 });
  assert.equal(mock.calls.generated, 1);
  assert.equal(mock.calls.claimed, 1);
  assert.match(mock.sentMessages[0].html, /Generated deterministic draft/);
});

test("skips already sent official weekly review", async () => {
  const mock = createJobMock({
    initialReview: {
      ...baseReview,
      officialEmailStatus: "sent",
      officialEmailSentAt: "2026-05-03T23:00:00.000Z",
    },
  });
  const result = await deliverWeeklyReviewEmails(mock.options);

  assert.deepEqual(result.counts, { generated: 0, sent: 0, skipped: 1, failed: 0 });
  assert.equal(mock.calls.claimed, 0);
  assert.equal(mock.sentMessages.length, 0);
});

test("repeat invocation race skips when claim already won elsewhere", async () => {
  const mock = createJobMock({ claimResult: null });
  const result = await deliverWeeklyReviewEmails(mock.options);

  assert.deepEqual(result.counts, { generated: 0, sent: 0, skipped: 1, failed: 0 });
  assert.equal(mock.calls.claimed, 1);
  assert.equal(mock.sentMessages.length, 0);
});

test("send failure marks review failed without sent metadata", async () => {
  const mock = createJobMock({ sendError: { message: "resend down" } });
  const result = await deliverWeeklyReviewEmails(mock.options);

  assert.deepEqual(result.counts, { generated: 0, sent: 0, skipped: 0, failed: 1 });
  assert.equal(mock.calls.markedSent, 0);
  assert.equal(mock.calls.markedFailed, 1);
  assert.match(result.logs[0].reason ?? "", /resend down/);
});

test("thrown send failure marks review failed without sent metadata", async () => {
  const mock = createJobMock({ throwSendError: new Error("network down") });
  const result = await deliverWeeklyReviewEmails(mock.options);

  assert.deepEqual(result.counts, { generated: 0, sent: 0, skipped: 0, failed: 1 });
  assert.equal(mock.calls.markedSent, 0);
  assert.equal(mock.calls.markedFailed, 1);
  assert.match(result.logs[0].reason ?? "", /network down/);
});
