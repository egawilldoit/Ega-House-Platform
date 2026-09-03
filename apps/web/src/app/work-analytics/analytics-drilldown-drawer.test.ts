import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
  resolve(process.cwd(), "src/app/work-analytics/analytics-drilldown-drawer.tsx"),
  "utf8",
);

test("analytics drilldown gives its dialog the visible title as an accessible name", () => {
  assert.match(source, /<SheetContent[^>]+aria-labelledby="analytics-drilldown-title"/);
  assert.match(source, /<SheetTitle id="analytics-drilldown-title">\{drawerTitle\(drilldown\)\}<\/SheetTitle>/);
});
