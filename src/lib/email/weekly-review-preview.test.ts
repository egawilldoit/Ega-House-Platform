import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWeeklyReviewEmail,
  sendWeeklyReviewPreviewEmail,
  WEEKLY_REVIEW_EMAIL_SUBJECT,
  type WeeklyReviewEmailRecord,
} from "./weekly-review-preview";

const review: WeeklyReviewEmailRecord = {
  id: "review-123",
  weekStart: "2026-04-13",
  weekEnd: "2026-04-19",
  summary: [
    "Weekly Summary",
    "Shipped weekly review generation.",
    "",
    "Time Breakdown",
    "- EGA House: 4h 20m across 3 sessions",
  ].join("\n"),
  wins: ["Wins", "- Completed canonical fields"].join("\n"),
  blockers: ["Main Blockers", "- Resend config missing locally"].join("\n"),
  nextSteps: [
    "Carried-Over Tasks",
    "- Finish email template",
    "",
    "Suggested Next Steps",
    "- Test manual preview send",
  ].join("\n"),
};

test("weekly review email renders canonical saved review sections", () => {
  const email = buildWeeklyReviewEmail(review, "https://app.example.com/");

  assert.equal(email.subject, WEEKLY_REVIEW_EMAIL_SUBJECT);
  assert.match(email.html, /Weekly Summary/);
  assert.match(email.html, /Shipped weekly review generation/);
  assert.match(email.html, /Wins/);
  assert.match(email.html, /Completed canonical fields/);
  assert.match(email.html, /Time Breakdown/);
  assert.match(email.html, /EGA House: 4h 20m across 3 sessions/);
  assert.match(email.html, /Blockers/);
  assert.match(email.html, /Resend config missing locally/);
  assert.match(email.html, /Carried-Over Tasks/);
  assert.match(email.html, /Finish email template/);
  assert.match(email.html, /Suggested Next Week Plan/);
  assert.match(email.html, /Test manual preview send/);
});

test("weekly review email links to correct review page and week", () => {
  const email = buildWeeklyReviewEmail(review, "https://app.example.com");

  assert.equal(
    email.reviewUrl,
    "https://app.example.com/review/review-123?weekOf=2026-04-13",
  );
  assert.match(
    email.html,
    /https:\/\/app\.example\.com\/review\/review-123\?weekOf=2026-04-13/,
  );
  assert.match(email.html, /Open full review/);
});

test("manual weekly review preview send succeeds through injected sender", async () => {
  const sentMessages: Array<{ from: string; to: string; subject: string; html: string }> = [];
  const result = await sendWeeklyReviewPreviewEmail({
    review,
    appUrl: "https://app.example.com",
    from: "EGA <noreply@example.com>",
    to: "owner@example.com",
    send: async (message) => {
      sentMessages.push(message);
      return { data: { id: "email-123" } };
    },
  });

  assert.deepEqual(result, {
    ok: true,
    id: "email-123",
    reviewUrl: "https://app.example.com/review/review-123?weekOf=2026-04-13",
  });
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].subject, WEEKLY_REVIEW_EMAIL_SUBJECT);
  assert.match(sentMessages[0].html, /Preview sent by EGA House/);
});

test("manual weekly review preview send returns clear failure", async () => {
  const result = await sendWeeklyReviewPreviewEmail({
    review,
    appUrl: "https://app.example.com",
    from: "EGA <noreply@example.com>",
    to: "owner@example.com",
    send: async () => ({ error: { message: "Rate limited" } }),
  });

  assert.deepEqual(result, {
    ok: false,
    error: "Resend failed to send weekly review preview.",
  });
});
