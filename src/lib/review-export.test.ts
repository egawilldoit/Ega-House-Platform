import assert from "node:assert/strict";
import test from "node:test";

import { buildReviewExportCsv, getReviewExportWeekOf } from "./review-export";

test("getReviewExportWeekOf accepts only ISO dates", () => {
  assert.equal(getReviewExportWeekOf(new URLSearchParams("weekOf=2026-04-13")), "2026-04-13");
  assert.equal(getReviewExportWeekOf(new URLSearchParams("weekOf=2026-4-13")), null);
  assert.equal(getReviewExportWeekOf(new URLSearchParams("foo=bar")), null);
});

test("buildReviewExportCsv includes review fields and computed weekly stats", () => {
  const csv = buildReviewExportCsv({
    reviews: [
      {
        id: "review-1",
        week_start: "2026-04-13",
        week_end: "2026-04-19",
        summary: "Closed the loop",
        wins: "Ship export",
        blockers: "None",
        next_steps: "Keep momentum",
        created_at: "2026-04-18T10:00:00.000Z",
        updated_at: "2026-04-18T11:00:00.000Z",
      },
    ],
    statSourcesByWeek: {
      "2026-04-13": {
        taskCount: 3,
        sessionRows: [
          {
            started_at: "2026-04-14T09:00:00.000Z",
            ended_at: "2026-04-14T10:00:00.000Z",
            duration_seconds: null,
          },
          {
            started_at: "2026-04-15T09:00:00.000Z",
            ended_at: "2026-04-15T09:30:00.000Z",
            duration_seconds: 1800,
          },
        ],
        goalStatuses: ["active", "paused", "draft"],
      },
    },
  });

  assert.match(csv, /review_id,week_start,week_end,summary/);
  assert.match(csv, /review-1,2026-04-13,2026-04-19,Closed the loop,Ship export,None,Keep momentum,3,2,5400,3,2/);
});
