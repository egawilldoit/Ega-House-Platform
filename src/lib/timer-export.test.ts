import assert from "node:assert/strict";
import test from "node:test";

import { buildTimerExportCsv } from "./timer-export";

test("buildTimerExportCsv serializes timer rows with computed duration", () => {
  const csv = buildTimerExportCsv(
    [
      {
        id: "session-1",
        task_id: "task-1",
        started_at: "2026-04-18T09:00:00.000Z",
        ended_at: null,
        duration_seconds: null,
        created_at: "2026-04-18T09:00:00.000Z",
        updated_at: "2026-04-18T09:00:00.000Z",
        tasks: {
          title: "Write export",
          status: "in_progress",
          priority: "high",
          goals: { title: "Ship reporting" },
          projects: { name: "EGA House", slug: "ega-house" },
        },
      },
    ],
    "2026-04-18T09:15:00.000Z",
  );

  assert.match(csv, /session_id,task_id,task_title/);
  assert.match(
    csv,
    /session-1,task-1,Write export,in_progress,high,Ship reporting,EGA House,ega-house,2026-04-18T09:00:00.000Z,,900,2026-04-18T09:00:00.000Z,2026-04-18T09:00:00.000Z/,
  );
});
