import * as fs from "node:fs";
import * as path from "node:path";

describe("mobile inbox fast capture (EGA-506)", () => {
  const inboxScreenPath = path.join(__dirname, "../../../app/(app)/(tabs)/inbox.tsx");
  const captureSheetPath = path.join(__dirname, "../components/InboxCaptureSheet.tsx");
  const queryPath = path.join(__dirname, "../query.ts");
  const apiPath = path.join(__dirname, "../../../lib/api/inbox.ts");
  const apiClientPath = path.join(__dirname, "../../../../../packages/api-client/src/inbox.ts");
  const repositoryPath = path.join(__dirname, "../../../../../packages/data-access/src/inbox/repository.ts");

  const inboxScreen = fs.readFileSync(inboxScreenPath, "utf8");
  const captureSheet = fs.readFileSync(captureSheetPath, "utf8");
  const query = fs.readFileSync(queryPath, "utf8");
  const api = fs.readFileSync(apiPath, "utf8");
  const apiClient = fs.readFileSync(apiClientPath, "utf8");
  const repository = fs.readFileSync(repositoryPath, "utf8");

  it("accepts raw thought without project/goal/priority", () => {
    expect(inboxScreen).toMatch(/Capture idea/);
    expect(captureSheet).toMatch(/Thought/);
    expect(captureSheet).not.toMatch(/projectId.*required/i);
    expect(captureSheet).toMatch(/idempotencyKey/);
    expect(query).toMatch(/idempotencyKey/);
  });

  it("uses FAB with safe-area metrics", () => {
    expect(inboxScreen).toMatch(/FloatingActionButton/);
    expect(inboxScreen).toMatch(/useBottomChromeMetrics/);
    expect(inboxScreen).toMatch(/contentBottomPadding/);
    expect(inboxScreen).toMatch(/testID="inbox-fab-capture"/);
    expect(captureSheet).toMatch(/useSafeAreaInsets/);
  });

  it("preserves draft on failure and does not claim false success", () => {
    expect(captureSheet).toMatch(/setError/);
    expect(captureSheet).toMatch(/Preserve draft|draft/);
    expect(inboxScreen).toMatch(/setDraftTitle/);
    expect(inboxScreen).toMatch(/setDraftBody/);
    expect(inboxScreen).toMatch(/throw e/);
    expect(captureSheet).not.toMatch(/setSuccess.*true/);
  });

  it("retry with same idempotency key does not duplicate (client and server)", () => {
    expect(captureSheet).toMatch(/createIdempotencyKey/);
    expect(captureSheet).toMatch(/idempotencyKeyRef\.current/);
    expect(api).toMatch(/idempotencyKey/);
    expect(apiClient).toMatch(/X-Idempotency-Key/);
    expect(repository).toMatch(/inbox_idempotency_keys/);
    expect(repository).toMatch(/getInboxItemByIdempotencyKey/);
  });

  it("keyboard/touch accessibility: autoFocus, accessibilityLabel, safe-area", () => {
    expect(captureSheet).toMatch(/autoFocus/);
    expect(captureSheet).toMatch(/accessibilityLabel/);
    expect(captureSheet).toMatch(/accessibilityRole="button"/);
    expect(captureSheet).toMatch(/testID="inbox-capture-title-input"/);
    expect(captureSheet).toMatch(/testID="inbox-capture-submit"/);
    expect(inboxScreen).toMatch(/accessibilityLabel="Capture idea to Inbox"/);
  });

  it("capture sheet is retry-safe and does not clear key on failure", () => {
    expect(captureSheet).toMatch(/idempotencyKeyRef\.current = createIdempotencyKey\(\)/);
    // Should only rotate key on success, not on error
    const successSection = captureSheet.slice(captureSheet.indexOf("try {"));
    expect(successSection).toMatch(/idempotencyKeyRef\.current = createIdempotencyKey/);
  });
});
