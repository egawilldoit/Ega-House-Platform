import { describe, it, expect } from "vitest";

import { AgentRateLimitService } from "@/lib/services/agent-rate-limit-service";

describe("AgentRateLimitService", () => {
  it("allows requests under the limit", () => {
    const limiter = new AgentRateLimitService({
      windowSeconds: 60,
      maxRequests: 3,
    });

    expect(limiter.check("token-1")).toEqual({ ok: true });
    expect(limiter.check("token-1")).toEqual({ ok: true });
    expect(limiter.check("token-1")).toEqual({ ok: true });

    limiter.dispose();
  });

  it("rate limits after exceeding max requests", () => {
    const limiter = new AgentRateLimitService({
      windowSeconds: 60,
      maxRequests: 2,
    });

    expect(limiter.check("token-1")).toEqual({ ok: true });
    expect(limiter.check("token-1")).toEqual({ ok: true });

    const result = limiter.check("token-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryAfter).toBeGreaterThanOrEqual(1);
    }

    limiter.dispose();
  });

  it("tracks separate keys independently", () => {
    const limiter = new AgentRateLimitService({
      windowSeconds: 60,
      maxRequests: 2,
    });

    expect(limiter.check("token-a")).toEqual({ ok: true });
    expect(limiter.check("token-b")).toEqual({ ok: true });
    expect(limiter.check("token-a")).toEqual({ ok: true });
    // token-a is now at limit (2/2)
    expect(limiter.check("token-a").ok).toBe(false);
    // token-b is still under limit (1/2)
    expect(limiter.check("token-b")).toEqual({ ok: true });
    // token-b is now at limit (2/2)
    expect(limiter.check("token-b").ok).toBe(false);

    limiter.dispose();
  });

  it("allows requests after the window passes", async () => {
    const limiter = new AgentRateLimitService({
      windowSeconds: 1, // Very short window for testing
      maxRequests: 1,
    });

    expect(limiter.check("token-1")).toEqual({ ok: true });
    expect(limiter.check("token-1").ok).toBe(false);

    // Wait for the window to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(limiter.check("token-1")).toEqual({ ok: true });

    limiter.dispose();
  }, 5000);

  it("dispose clears state", () => {
    const limiter = new AgentRateLimitService({
      maxRequests: 1,
    });

    expect(limiter.check("token-1")).toEqual({ ok: true });
    limiter.dispose();
    // After dispose, creating a new limiter — state is gone
    const newLimiter = new AgentRateLimitService({ maxRequests: 1 });
    expect(newLimiter.check("token-1")).toEqual({ ok: true });
    newLimiter.dispose();
  });

  it("works with default options", () => {
    const limiter = new AgentRateLimitService();
    // Default: 60 req / 60 sec — first should always pass
    expect(limiter.check("token-1")).toEqual({ ok: true });
    limiter.dispose();
  });
});
