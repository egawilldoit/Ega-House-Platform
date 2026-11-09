import { readFileSync } from "node:fs";

// Deliberately explicit: deleting/renaming a journey requires reviewing this contract.
export const journeys = {
  "auth-session.e2e.spec.ts": [
    "protected pages reject a signed-out browser",
    "real login survives reload and logout revokes protected access",
  ],
  "disposable-journeys.e2e.spec.ts": [
    "created task persists and owner B cannot read, update or delete it",
    "Money survives reload, exports only the owner, then edits and deletes",
    "shutdown check-in and routine evidence persist through a reload",
    "notification read state and channel preference survive reload",
  ],
  "notification-settings.e2e.spec.ts": [
    "notification settings PATCH preserves concurrent fields, rejects conflicts and isolates owners",
  ],
  "kanban-board.e2e.spec.ts": [
    "drag To Do → In Progress persists after reload at desktop and phone",
    "keyboard ordering with the drag handle persists",
  ],
  "pwa-morning-startup.e2e.spec.ts": [
    "owner starts the day with known outcomes, recovers a timer and saves its outcome",
    "two timer clients reconcile a competing start and safely retry an old stop",
  ],
  "pwa-personal-operations.e2e.spec.ts": [
    "owner edits, reloads and pauses a personal schedule through the redesigned UI",
    "dirty schedule survives browser Back/Forward and clears after Discard",
    "confirmed anchor leave discards the draft and reaches the destination once",
    "server rejects overlapping guidance without persisting the edited target",
    "reduced motion and keyboard editing save and restore the schedule",
  ],
};

export function verifyReport(report) {
  const wanted = new Set(Object.entries(journeys).flatMap(([file, titles]) => titles.map(title => `${file}:${title}`)));
  const seen = new Set();
  let count = 0;
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      const file = String(spec.file).replaceAll("\\", "/").split("/").at(-1);
      for (const test of spec.tests ?? []) {
        const identity = `${file}:${spec.title}`;
        if (!wanted.has(identity) || seen.has(identity)) throw new Error("Unexpected or duplicate journey");
        seen.add(identity);
        count++;
        if (spec.ok !== true || test.projectName !== "chromium-disposable" || test.expectedStatus !== "passed" || test.status !== "expected" ||
          !Array.isArray(test.results) || test.results.length !== 1 || test.results[0].status !== "passed" || test.results[0].retry !== 0 ||
          (test.results[0].errors?.length ?? 0) !== 0) throw new Error("Journey did not pass exactly once");
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  try {
    if (!Array.isArray(report.suites) || !Array.isArray(report.errors) || report.errors.length) return false;
    for (const suite of report.suites) visit(suite);
    return count === wanted.size && seen.size === wanted.size && report.stats?.expected === wanted.size &&
      ["unexpected", "flaky", "skipped"].every(key => report.stats[key] === 0);
  } catch { return false; }
}

if (process.argv[1]?.endsWith("assert-disposable-report.mjs")) {
  let verified = false;
  try { verified = verifyReport(JSON.parse(readFileSync(process.argv[2] ?? "apps/web/test-results/disposable-results.json", "utf8"))); } catch { /* Missing reports fail closed. */ }
  console.log(verified ? "AUTHENTICATED_JOURNEYS_VERIFIED: 16 passed once" : "AUTHENTICATED_JOURNEYS_UNVERIFIED: incomplete or failing report");
  if (!verified) process.exitCode = 1;
}
