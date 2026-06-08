// Simple in-memory sliding-window rate limiter keyed by token ID.
// NOTE: This is a single-process, in-memory implementation suitable for
// development and low-traffic deployments. For production use across
// multiple instances, replace this with a DB-backed (e.g. Redis) solution.

type WindowEntry = {
  timestamps: number[]; // Monotonic timestamps (ms) of requests in current window
};

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfter: number };

export type RateLimitOptions = {
  windowSeconds?: number;
  maxRequests?: number;
  cleanupIntervalMs?: number;
};

const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX_REQUESTS = 60;
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000; // 1 minute

export class AgentRateLimitService {
  private readonly windowSeconds: number;
  private readonly maxRequests: number;
  private readonly store = new Map<string, WindowEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: RateLimitOptions) {
    this.windowSeconds = options?.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
    this.maxRequests = options?.maxRequests ?? DEFAULT_MAX_REQUESTS;

    if (typeof setInterval !== "undefined") {
      this.cleanupTimer = setInterval(
        () => this.cleanup(),
        options?.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS,
      );
      // Allow the Node.js process to exit even if the timer is still active
      if (this.cleanupTimer && typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
        this.cleanupTimer.unref();
      }
    }
  }

  /**
   * Check if a request from the given token ID is allowed.
   * Returns { ok: true } if under the limit, or { ok: false, retryAfter } if rate limited.
   */
  check(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.windowSeconds * 1000;

    let entry = this.store.get(key);

    // Prune timestamps outside the window
    if (entry) {
      entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
    }

    if (!entry || entry.timestamps.length === 0) {
      // First request in the window
      if (!entry) {
        entry = { timestamps: [] };
        this.store.set(key, entry);
      }
      entry.timestamps.push(now);
      return { ok: true };
    }

    const currentCount = entry.timestamps.length;

    if (currentCount >= this.maxRequests) {
      // Rate limited — calculate retry-after from oldest timestamp in window
      const oldest = entry.timestamps[0]!;
      const retryAfter = Math.ceil((oldest + this.windowSeconds * 1000 - now) / 1000);
      return { ok: false, retryAfter: Math.max(1, retryAfter) };
    }

    entry.timestamps.push(now);
    return { ok: true };
  }

  /**
   * Dispose the rate limiter. Clears the interval timer and the store.
   */
  dispose(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
  }

  /**
   * Remove stale entries to prevent memory leaks.
   */
  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowSeconds * 1000;

    for (const [key, entry] of this.store.entries()) {
      entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
      if (entry.timestamps.length === 0) {
        this.store.delete(key);
      }
    }
  }
}
