import assert from "node:assert/strict";
import test from "node:test";

import { formatDateTime } from "./review-week";

test("formatDateTime renders profile timezone without a UTC suffix", () => {
  assert.equal(
    formatDateTime("2026-10-14T16:57:00.000Z", "Asia/Tokyo"),
    "Oct 15, 2026, 1:57 AM",
  );
});

test("formatDateTime falls back to UTC without a zone suffix", () => {
  assert.equal(
    formatDateTime("2026-10-14T16:57:00.000Z"),
    "Oct 14, 2026, 4:57 PM",
  );
  assert.ok(!formatDateTime("2026-10-14T16:57:00.000Z").includes("UTC"));
});
