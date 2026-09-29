import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const page = readFileSync(
  path.join(process.cwd(), "src", "app", "tasks", "projects", "[slug]", "page.tsx"),
  "utf8",
);

test("project detail due filters use the account local date from Time Context", () => {
  // The Overdue / Due today / Due soon pills must filter with the owner's EGA
  // House local date resolved through the canonical web Time Context seam,
  // never the server/runtime-local day.
  assert.match(page, /getWebTimeContext/);
  assert.match(page, /today: timeContext\?\.localDate/);
  assert.match(
    page,
    /applyTaskListQuery\(\s*tasks\.filter\([\s\S]*?\),\s*\{\s*dueFilter: activeDueFilter,\s*sortValue: activeSort,\s*today: timeContext\?\.localDate,\s*\},\s*\)/,
  );
});
