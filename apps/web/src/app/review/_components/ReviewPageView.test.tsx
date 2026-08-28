import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const view = readFileSync(resolve(process.cwd(), "src/app/review/_components/ReviewPageView.tsx"), "utf8");

describe("Review — email preview preserved", () => {
  it("preserves ReviewEmailPreviewForm with preview semantics", () => {
    expect(view).toContain("ReviewEmailPreviewForm");
    expect(view).toContain("Email Preview");
    // Must preserve distinction between preview and canonical send
    expect(view).toContain("Send current saved weekly review through Resend without changing official send state");
    expect(view).toContain('reviewId={selectedReview?.id ?? null}');
  });
});
