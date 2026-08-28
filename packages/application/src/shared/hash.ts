import { createHash } from "node:crypto";

/**
 * sha256Hex — shared deterministic hash utility for application layer.
 *
 * Purity evaluation (repair 2026-08-28):
 * - `node:crypto` is Node.js stdlib, available in all app/server runtimes and Node test runner.
 * - `scripts/ci/package-purity.mjs` allows `node:` imports in `packages/application` (only forbids
 *   Next/React/Supabase/ORM). Contracts/domain forbid `node:`, but application is permitted.
 * - Extracting to this shared utility centralizes the dependency, makes it mockable for tests,
 *   and documents intent. Domain remains pure (no crypto). Data-access uses Supabase, not hashing.
 * - Alternative (inject hash function) considered but not needed: deterministic ID is a small,
 *   pure requirement and direct import keeps simplest change without threading through ports.
 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
