import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const pagePath = resolve(import.meta.dirname, "./page.tsx");

test("Review links to the retained timer session history", () => {
  const source = readFileSync(pagePath, "utf8");

  assert.match(
    source,
    /href="\/timer#recent-sessions"/,
    "Review must deep-link to the timer history section",
  );
  assert.match(source, /Timer history/, "The link needs a discoverable label");
  assert.match(source, /CanonicalLink/, "cross-workspace links must resolve on the canonical host");
});

test("the timer route and its recent-session anchor stay real pages", () => {
  assert.equal(
    existsSync(resolve(process.cwd(), "src/app/(workspace)/timer/page.tsx")),
    true,
    "the /timer page route must exist",
  );

  const nextConfig = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");
  assert.doesNotMatch(
    nextConfig,
    /source:\s*"\/timer"/,
    "a config redirect must not shadow timer recovery and session history",
  );

  const timerView = readFileSync(
    resolve(process.cwd(), "src/app/(workspace)/timer/_components/TimerPageView.tsx"),
    "utf8",
  );
  assert.match(timerView, /id="recent-sessions"/, "the deep-link anchor must exist");
});
