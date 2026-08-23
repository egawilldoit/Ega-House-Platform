// ── In-memory Rate Limiter ──
// Layered: IP, principal, device, endpoint, token refresh, WebSocket connections.
// All testable without nginx. Uses sliding-window counters.

import { randomBytes } from 'node:crypto';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
}

interface WindowEntry {
  count: number;
  windowStart: number;
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number;  // tokens per second
}

export class RateLimiter {
  // Sliding-window counters keyed by `namespace:key`
  private windows = new Map<string, WindowEntry>();
  // Token buckets for connection-based limits
  private buckets = new Map<string, TokenBucket>();

  private windowMs: number;

  constructor(windowMs = 60_000) {
    this.windowMs = windowMs;
  }

  /**
   * Sliding-window counter. Returns whether the request is allowed.
   * @param namespace e.g. 'ip', 'principal', 'device', 'endpoint'
   * @param key e.g. '127.0.0.1', 'principal_abc', 'dev_123', 'POST:/v1/runs'
   * @param maxRequests maximum requests per window
   */
  checkWindow(namespace: string, key: string, maxRequests: number): RateLimitResult {
    const mapKey = `${namespace}:${key}`;
    const now = Date.now();

    let entry = this.windows.get(mapKey);
    if (!entry || now - entry.windowStart > this.windowMs) {
      entry = { count: 0, windowStart: now };
      this.windows.set(mapKey, entry);
    }

    const elapsed = now - entry.windowStart;
    const remaining = Math.max(0, maxRequests - entry.count);
    const resetAt = entry.windowStart + this.windowMs;

    if (entry.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterMs: resetAt - now,
      };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: remaining - 1,
      resetAt,
      retryAfterMs: 0,
    };
  }

  /**
   * Token bucket for WebSocket connection limits.
   * Each connection consumes one token. Tokens refill at a fixed rate.
   */
  checkTokenBucket(key: string, maxTokens: number, refillPerSec: number): RateLimitResult {
    const now = Date.now();

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: maxTokens, lastRefill: now, maxTokens, refillRate: refillPerSec };
      this.buckets.set(key, bucket);
    }

    // Refill
    const elapsedSec = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsedSec * bucket.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      const retryAfterMs = Math.ceil((1 - bucket.tokens) / bucket.refillRate * 1000);
      return {
        allowed: false,
        remaining: 0,
        resetAt: now + retryAfterMs,
        retryAfterMs,
      };
    }

    bucket.tokens--;
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      resetAt: now + 60_000, // approximate
      retryAfterMs: 0,
    };
  }

  /**
   * Release a token back to the bucket (e.g., WebSocket disconnect).
   */
  releaseToken(key: string): void {
    const bucket = this.buckets.get(key);
    if (bucket) {
      bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + 1);
    }
  }

  /**
   * Reset all counters (useful for tests).
   */
  reset(): void {
    this.windows.clear();
    this.buckets.clear();
  }
}

// ── Pre-configured rate limit presets ──

export const RATE_LIMIT_PRESETS = {
  // Per-IP
  ip: { windowMs: 60_000, maxRequests: 60 },
  // Per-principal (authenticated user)
  principal: { windowMs: 60_000, maxRequests: 120 },
  // Per-device
  device: { windowMs: 60_000, maxRequests: 60 },
  // Token refresh (strict)
  tokenRefresh: { windowMs: 60_000, maxRequests: 5 },
  // Device registration (strict, per IP)
  deviceRegistration: { windowMs: 3600_000, maxRequests: 3 }, // 3 per hour
  // WebSocket connections per device
  wsConnections: { maxTokens: 3, refillPerSec: 0.1 }, // 3 concurrent, refills slowly
  // Per-endpoint (sensitive)
  alertPoll: { windowMs: 60_000, maxRequests: 30 },
};
