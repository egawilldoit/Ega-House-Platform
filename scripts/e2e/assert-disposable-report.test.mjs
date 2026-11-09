import assert from "node:assert/strict";
import { test } from "node:test";
import { journeys, verifyReport } from "./assert-disposable-report.mjs";

function report() {
  return {
    errors: [], stats: { expected: 16, unexpected: 0, flaky: 0, skipped: 0 },
    suites: Object.entries(journeys).map(([file, titles]) => ({ specs: titles.map(title => ({
      title, file, ok: true, tests: [{ projectName: "chromium-disposable", expectedStatus: "passed", status: "expected", results: [{ status: "passed", retry: 0 }] }],
    })) })),
  };
}

test("requires every reviewed journey exactly once with no skips, retries or expected failures", () => {
  assert.equal(verifyReport(report()), true);
  for (const change of [
    r => r.suites.pop(),
    r => r.suites.push(r.suites[0]),
    r => { r.suites[0].specs[0].file = "unreviewed.spec.ts"; },
    r => { r.suites[0].specs[0].title = "unreviewed journey"; },
    r => { r.suites[0].specs[0].ok = false; },
    r => { r.suites[0].specs[0].tests[0].projectName = "other"; },
    r => { r.suites[0].specs[0].tests[0].expectedStatus = "failed"; },
    r => { r.suites[0].specs[0].tests[0].results[0].status = "skipped"; },
    r => { r.suites[0].specs[0].tests[0].results[0].retry = 1; },
    r => { r.suites[0].specs[0].tests[0].results.push({ status: "passed", retry: 1 }); },
    r => { r.suites[0].specs[0].tests[0].results[0].errors = [{ message: "late error" }]; },
    r => { r.stats.expected = 15; },
    r => { r.stats.skipped = 1; },
    r => { r.stats.flaky = 1; },
    r => { r.errors.push({ message: "interrupted" }); },
  ]) { const value = report(); change(value); assert.equal(verifyReport(value), false); }
  for (const value of [null, {}, { suites: null }, { suites: [{}], errors: [] }]) assert.equal(verifyReport(value), false);
});
