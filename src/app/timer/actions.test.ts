import assert from "node:assert/strict";
import test from "node:test";

import {
  completeStoppedTaskById,
  handleStoppedTimerOutcomeByTaskId,
} from "./actions";

test("completeStoppedTaskById marks a stopped task done via shared task update service", async () => {
  const calls = {
    markTaskDone: [] as string[],
  };

  const result = await completeStoppedTaskById("task-1", {
    markTaskDone: async (taskId: string) => {
      calls.markTaskDone.push(taskId);
      return { errorMessage: null };
    },
    resumeTask: async () => ({ errorMessage: null }),
    blockTask: async () => ({ errorMessage: null }),
  });

  assert.equal(result.errorMessage, null);
  assert.deepEqual(calls.markTaskDone, ["task-1"]);
});

test("completeStoppedTaskById returns transition errors", async () => {
  let markDoneCalled = false;

  const result = await completeStoppedTaskById("task-1", {
    markTaskDone: async () => {
      markDoneCalled = true;
      return { errorMessage: "Unable to update task right now." };
    },
    resumeTask: async () => ({ errorMessage: null }),
    blockTask: async () => ({ errorMessage: null }),
  });

  assert.equal(result.errorMessage, "Unable to update task right now.");
  assert.equal(markDoneCalled, true);
});

test("handleStoppedTimerOutcomeByTaskId marks stopped task blocked with a reason", async () => {
  const calls = {
    blockTask: [] as Array<{ taskId: string; blockedReason: string }>,
  };

  const result = await handleStoppedTimerOutcomeByTaskId(
    "task-1",
    "blocked",
    "Waiting on vendor",
    {
      markTaskDone: async () => ({ errorMessage: null }),
      resumeTask: async () => ({ errorMessage: null }),
      blockTask: async (taskId: string, reason: string) => {
        calls.blockTask.push({ taskId, blockedReason: reason });
        return { errorMessage: null };
      },
    },
  );

  assert.equal(result.errorMessage, null);
  assert.deepEqual(calls.blockTask, [
    { taskId: "task-1", blockedReason: "Waiting on vendor" },
  ]);
});

test("handleStoppedTimerOutcomeByTaskId requires blocked reason", async () => {
  let updateCalled = false;

  const result = await handleStoppedTimerOutcomeByTaskId("task-1", "blocked", " ", {
    markTaskDone: async () => ({ errorMessage: null }),
    resumeTask: async () => ({ errorMessage: null }),
    blockTask: async () => {
      updateCalled = true;
      return { errorMessage: null };
    },
  });

  assert.equal(result.errorMessage, "Blocked reason is required when status is Blocked.");
  assert.equal(updateCalled, false);
});

test("handleStoppedTimerOutcomeByTaskId leaves task unchanged for no_change", async () => {
  let updateCalled = false;

  const result = await handleStoppedTimerOutcomeByTaskId("task-1", "no_change", null, {
    markTaskDone: async () => {
      updateCalled = true;
      return { errorMessage: null };
    },
    resumeTask: async () => {
      updateCalled = true;
      return { errorMessage: null };
    },
    blockTask: async () => {
      updateCalled = true;
      return { errorMessage: null };
    },
  });

  assert.equal(result.errorMessage, null);
  assert.equal(updateCalled, false);
});
