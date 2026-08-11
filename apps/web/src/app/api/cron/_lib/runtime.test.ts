import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeCronRequest,
  missingCronEnvResponse,
} from "./runtime";

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

test("missing cron env response preserves shared error envelope", async () => {
  const response = missingCronEnvResponse(["CRON_SECRET", "EGA_OWNER_USER_ID"]);

  assert.equal(response.status, 500);
  assert.deepEqual(await readJson(response), {
    ok: false,
    error: "Missing required environment variable(s): CRON_SECRET, EGA_OWNER_USER_ID",
  });
});

test("cron authorization reports missing CRON_SECRET", async () => {
  const result = authorizeCronRequest(
    new Request("https://app.example.com/api/cron/job", { method: "POST" }),
    undefined,
  );

  assert.ok(result instanceof Response);
  assert.equal(result.status, 500);
  assert.deepEqual(await readJson(result), {
    ok: false,
    error: "Missing required environment variable(s): CRON_SECRET",
  });
});

test("cron authorization rejects the wrong bearer secret", async () => {
  const result = authorizeCronRequest(
    new Request("https://app.example.com/api/cron/job", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    }),
    "expected-secret",
  );

  assert.ok(result instanceof Response);
  assert.equal(result.status, 401);
  assert.deepEqual(await readJson(result), { ok: false, error: "Unauthorized" });
});

test("cron authorization returns null for the exact bearer secret", () => {
  const result = authorizeCronRequest(
    new Request("https://app.example.com/api/cron/job", {
      method: "POST",
      headers: { authorization: "Bearer expected-secret" },
    }),
    "expected-secret",
  );

  assert.equal(result, null);
});
