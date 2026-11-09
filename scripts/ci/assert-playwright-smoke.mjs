#!/usr/bin/env node
import { readFileSync } from "node:fs";

const path = process.argv[2];
const expectedTitles = new Set([
  "public homepage contract @smoke",
  "login form is present without signing in @smoke",
  "signup form is present without submission @smoke",
]);
const expectedCount = expectedTitles.size; // Reviewed coverage contract.
if (!path) throw new Error("Usage: node scripts/ci/assert-playwright-smoke.mjs <report.json>");

let report;
try {
  report = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  console.error("SMOKE_UNVERIFIED: JSON report missing or unreadable:", error.message);
  process.exit(1);
}

const s = report?.stats;
const counts = ["expected", "unexpected", "flaky", "skipped"];
const suitesValid = Array.isArray(report.suites);
const statsValid = s && counts.every(k => Number.isInteger(s[k]) && s[k] >= 0);
const record = [];
function visit(suite) {
  if (!suite || typeof suite !== "object") throw new Error("Invalid suite");
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) record.push({ spec, t });
  }
  for (const nested of suite.suites ?? []) visit(nested);
}
try { if (suitesValid) for (const suite of report.suites) visit(suite); }
catch { console.error("SMOKE_UNVERIFIED: malformed nested suite"); process.exit(1); }

const actualTitles = record.map(({ spec }) => spec.title);
const titleSetMatches = new Set(actualTitles).size === expectedCount &&
  actualTitles.every(title => expectedTitles.has(title));
const allCorrect = record.every(({ spec, t }) =>
  Array.isArray(spec.tags) && spec.tags.includes("smoke") &&
  String(spec.file ?? "").replaceAll("\\", "/").split("/").at(-1) === "smoke-public.e2e.spec.ts" &&
  spec.ok === true && t.projectName === "chromium-smoke" &&
  t.expectedStatus === "passed" && t.status === "expected" &&
  Array.isArray(t.results) && t.results.length === 1 &&
  t.results[0].status === "passed" && t.results[0].retry === 0
);
const pass = Boolean(
  suitesValid && statsValid && Array.isArray(report.errors) && report.errors.length === 0 &&
  record.length === expectedCount && titleSetMatches && s.expected === expectedCount &&
  s.unexpected === 0 && s.flaky === 0 && s.skipped === 0 && allCorrect
);
console.log(`Smoke report: expected=${s?.expected ?? "?"}, selected=${record.length}, ` +
  `unexpected=${s?.unexpected ?? "?"}, flaky=${s?.flaky ?? "?"}, skipped=${s?.skipped ?? "?"}`);
if (!pass) {
  console.error("SMOKE_UNVERIFIED: missing/skipped/flaky/unexpected/incorrect tests");
  process.exit(1);
}
console.log("SMOKE_VERIFIED");
