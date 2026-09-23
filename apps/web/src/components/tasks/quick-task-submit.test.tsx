import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "src/components/tasks/quick-task-sheet.tsx"), "utf8");

function submitButtonBlock(): string {
  const start = source.indexOf("function QuickTaskSubmitButton");
  assert.ok(start >= 0, "QuickTaskSubmitButton must exist");
  const end = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

test("quick task primary action uses the canonical Button system", () => {
  const block = submitButtonBlock();

  // The defect was a black-on-black control: legacy accent variables resolved to
  // the same near-black for surface and label, rendering an unreadable rectangle.
  assert.doesNotMatch(block, /--ega-gold/);
  assert.match(block, /variant="primary"/);
  assert.match(block, /<Button/);
});

test("quick task primary action always renders a visible label", () => {
  const block = submitButtonBlock();

  assert.match(block, /\{pending \? "Creating\\u2026" : label\}/);
  // The label element is not conditioned away and carries no opacity that would
  // hide it.
  assert.doesNotMatch(block, /text-transparent/);
  assert.doesNotMatch(block, /hidden>\{label\}/);
});

test("quick task disabled state stays legible instead of fading the control", () => {
  const block = submitButtonBlock();

  assert.match(block, /disabled:bg-\[var\(--ega-surface-muted\)\]/);
  assert.match(block, /disabled:text-\[color:var\(--ega-text-secondary\)\]/);
  assert.match(block, /disabled:opacity-100/);
});

test("quick task exposes correct wording for both creation modes", () => {
  assert.match(source, /label="Create task"/);
  assert.match(source, /label="Create tasks"/);
});

test("quick task modal does not pin the footer to an empty full-height form", () => {
  // Dead vertical space came from a full-height form plus an auto-margin footer.
  assert.doesNotMatch(source, /min-h-full flex-col gap-4/);
  assert.doesNotMatch(source, /mt-auto flex items-center justify-between border-t/);
  assert.doesNotMatch(source, /mt-auto flex flex-col items-stretch justify-between/);
});

test("quick task dialog sizes to its content instead of reserving full height", () => {
  // A short state (for example "project required") must not render a tall empty
  // panel; long forms still grow to the cap and scroll internally.
  assert.match(source, /max-h-\[min\(50rem,calc\(100dvh-2rem\)\)\]/);
  assert.doesNotMatch(source, /h-\[calc\(100dvh-2rem\)\]/);
});
