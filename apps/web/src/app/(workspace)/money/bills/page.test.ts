import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const billsSource = readFileSync(resolve(import.meta.dirname, "./page.tsx"), "utf8");
const subscriptionsSource = readFileSync(
  resolve(import.meta.dirname, "../subscriptions/page.tsx"),
  "utf8",
);
const viewSource = readFileSync(
  resolve(import.meta.dirname, "../_components/obligations-view.tsx"),
  "utf8",
);
const actionsSource = readFileSync(
  resolve(import.meta.dirname, "../obligations-actions.ts"),
  "utf8",
);

test("bills and subscriptions render the same occurrence view filtered by kind", () => {
  assert.match(billsSource, /<ObligationsView kind="bill"/);
  assert.match(subscriptionsSource, /<ObligationsView kind="subscription"/);
  // One shared server component/repository; no second bill or subscription store.
  assert.match(viewSource, /new SupabaseObligationRepository\(client\)/);
  assert.match(viewSource, /listObligations\(actor, repository, \{\s*kind,/);
  assert.doesNotMatch(viewSource, /bill_paid|subscription_paid|paidFlag/);
});

test("the view derives the owner from verified auth and uses shared use cases", () => {
  assert.match(viewSource, /getCurrentUser\(\)/);
  assert.match(viewSource, /createAuthenticatedActor\(user\.id\)/);
  assert.match(viewSource, /getObligationSummary\(actor, repository/);
  assert.match(viewSource, /listObligationTemplates\(actor, repository/);
  assert.doesNotMatch(viewSource, /owner_user_id\s*:/);
  assert.doesNotMatch(viewSource, /user_id\s*:/);
});

test("totals distinguish unavailable from zero and state the cutoff", () => {
  assert.match(viewSource, /Outstanding at \{localToday\}/);
  assert.match(viewSource, /Outstanding totals are unavailable right now\. This is not a zero total\./);
  assert.match(viewSource, /summary\.cutoffDate/);
  assert.match(viewSource, /occurrenceCount/);
  assert.match(viewSource, /lower bound/);
});

test("scheduling and cancellation copy states no cash movement", () => {
  assert.match(viewSource, /Recording a scheduled obligation does not move cash/);
  assert.match(actionsSource, /No cash movement was posted/);
  assert.match(actionsSource, /Templates never post cash/);
});

test("paid occurrences expose the linked payment/evidence instead of a second flag", () => {
  assert.match(viewSource, /occurrence\.paymentExpenseId/);
  assert.match(viewSource, /reconciled historical import evidence/);
  assert.match(viewSource, /isPaid \?/);
  // No transition form can target paid from the UI.
  assert.doesNotMatch(viewSource, /to="paid"/);
});

test("lifecycle forms carry the version and an effective date", () => {
  assert.match(viewSource, /name="version" value=\{occurrence\.version\}/);
  assert.match(viewSource, /name="effectiveDate" value=\{localToday\}/);
  assert.match(actionsSource, /effectiveDate: text\(formData, "effectiveDate"\)/);
  assert.match(actionsSource, /version: Number\(text\(formData, "version"\)\)/);
});

test("forms never send caller identity and amounts parse to integer centimes", () => {
  assert.doesNotMatch(viewSource, /name="ownerUserId"/);
  assert.doesNotMatch(actionsSource, /ownerUserId/);
  assert.match(actionsSource, /parseMadAmountToMinor/);
  assert.match(actionsSource, /amountMinor: amount\.value/);
  assert.match(viewSource, /formatMinorToMad\(occurrence\.amountMinor\)/);
});
