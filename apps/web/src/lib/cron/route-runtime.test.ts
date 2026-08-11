import { describe, expect, it } from "vitest";

import {
  authorizeCronRequest,
  missingCronEnvResponse,
  runCronOperation,
} from "./route-runtime";

describe("cron route runtime", () => {
  it("rejects requests when CRON_SECRET is unavailable", async () => {
    const response = authorizeCronRequest(new Request("https://example.com"), undefined);
    expect(response?.status).toBe(500);
    await expect(response?.json()).resolves.toEqual({
      ok: false,
      error: "Missing required environment variable(s): CRON_SECRET",
    });
  });

  it("rejects an invalid bearer secret", async () => {
    const request = new Request("https://example.com", {
      headers: { authorization: "Bearer wrong" },
    });
    const response = authorizeCronRequest(request, "secret");
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ ok: false, error: "Unauthorized" });
  });

  it("accepts the configured bearer secret", () => {
    const request = new Request("https://example.com", {
      headers: { authorization: "Bearer secret" },
    });
    expect(authorizeCronRequest(request, "secret")).toBeNull();
  });

  it("formats missing env errors consistently", async () => {
    const response = missingCronEnvResponse(["A", "B"]);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Missing required environment variable(s): A, B",
    });
  });

  it("maps worker success and terminal failure without leaking thrown details", async () => {
    const success = await runCronOperation(async () => ({ ok: true, count: 2 }), "Failed worker.");
    expect(success.status).toBe(200);
    await expect(success.json()).resolves.toEqual({ ok: true, count: 2 });

    const failure = await runCronOperation(async () => {
      throw new Error("secret provider detail");
    }, "Failed worker.");
    expect(failure.status).toBe(500);
    await expect(failure.json()).resolves.toEqual({ ok: false, error: "Failed worker." });
  });
});
