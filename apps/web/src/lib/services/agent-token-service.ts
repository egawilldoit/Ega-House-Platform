// Authentication and token management service for agent tokens.
// Orchestrates crypto functions and the repository layer.
// Does NOT import @/db/client — accepts TokenRepository via DI.

import { parseBearerToken, verifyHash, hashToken, generateRawToken, validateHex64 } from "@/lib/crypto/agent-token";
import type { TokenRepository } from "@/lib/services/agent-token-repository";
import type {
  AgentAuthResult,
  AgentAuthContext,
  AgentCapabilities,
  AgentTokenScopes,
} from "@/lib/contracts/agent";

// ---- Cached lazy accessor for AGENT_TOKEN_PEPPER ----

let pepper: string | null = null;

function getPepper(): string {
  if (pepper === null) {
    const value = process.env.AGENT_TOKEN_PEPPER;
    if (!value || value.trim().length === 0) {
      throw new Error("AGENT_TOKEN_PEPPER is not configured");
    }
    pepper = value.trim();
  }
  return pepper;
}

/**
 * Reset the cached pepper value. Test-only usage — forces re-read from env.
 * Calling this in production is safe but unnecessary.
 */
export function resetPepper(): void {
  pepper = null;
}

// ---- Constants for error responses ----

const UNAUTHENTICATED_RESPONSE = {
  ok: false as const,
  error: {
    code: "UNAUTHENTICATED" as const,
    message: "Missing or invalid agent token.",
  },
};

const MAX_PREFIX_RETRIES = 3;

// ---- Public API ----

/**
 * Resolve authentication from an incoming request.
 *
 * Returns:
 *   - { ok: true, context } — authenticated successfully
 *   - { ok: false, response, status: 401 } — credential failure (identical for all types)
 *   - Throws — configuration or database errors (caught by HTTP handler → 500)
 */
export async function resolveAgentAuth(
  request: Request,
  repo: TokenRepository,
): Promise<AgentAuthResult> {
  // Step 1: Read Authorization header
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return { ok: false, response: UNAUTHENTICATED_RESPONSE, status: 401 };
  }

  // Step 2: Parse bearer token
  const parsed = parseBearerToken(authHeader);
  if (!parsed) {
    return { ok: false, response: UNAUTHENTICATED_RESPONSE, status: 401 };
  }

  // Step 3: Look up token by prefix
  const record = await repo.findByPrefix(parsed.prefix);
  if (!record) {
    return { ok: false, response: UNAUTHENTICATED_RESPONSE, status: 401 };
  }

  // Step 4: Check revocation
  if (record.revokedAt !== null) {
    return { ok: false, response: UNAUTHENTICATED_RESPONSE, status: 401 };
  }

  // Step 5: Validate stored hash format — corrupted storage is a server error
  if (!validateHex64(record.tokenHash)) {
    throw new Error("Corrupted stored token hash");
  }

  // Step 6: Verify HMAC hash (getPepper throws on missing→500)
  const pepper = getPepper();
  if (!verifyHash(parsed.secret, record.tokenHash, pepper)) {
    return { ok: false, response: UNAUTHENTICATED_RESPONSE, status: 401 };
  }

  return {
    ok: true,
    context: {
      tokenId: record.id,
      ownerUserId: record.ownerUserId,
      scopes: record.scopes,
    },
  };
}

/**
 * Generate a new agent token and persist it.
 * Returns the raw token string (shown once, cannot be retrieved again).
 */
export async function generateAgentToken(
  ownerUserId: string,
  name: string,
  scopes: AgentTokenScopes,
  repo: TokenRepository,
): Promise<string> {
  // Collision retry loop
  for (let attempt = 0; attempt < MAX_PREFIX_RETRIES; attempt++) {
    const { raw, prefix, secret } = generateRawToken();
    const hash = hashToken(secret, getPepper());

    try {
      await repo.insertToken({
        ownerUserId,
        name,
        tokenPrefix: prefix,
        tokenHash: hash,
        scopes,
      });
      return raw; // Success — token was inserted, return the raw token
    } catch (err: unknown) {
      const pgErr = err as { code?: string; constraint?: string };

      // Only retry on PostgreSQL unique violation (23505)
      // for the specific token-prefix unique constraint.
      if (pgErr.code === "23505") {
        // If the error specifies a constraint name that is not the prefix one,
        // this is an unrelated unique violation — propagate immediately.
        if (
          pgErr.constraint !== undefined &&
          pgErr.constraint !== "agent_token_prefix_unique"
        ) {
          throw err;
        }

        if (attempt === MAX_PREFIX_RETRIES - 1) {
          throw new Error(
            "Failed to generate unique token prefix after multiple attempts",
          );
        }
        continue; // Retry with new random prefix
      }

      // All other errors — propagate immediately
      throw err;
    }
  }

  throw new Error("Failed to generate unique token prefix");
}

/**
 * Map scopes to the capabilities response shape.
 * Deny-by-default: only capabilities explicitly set to true are returned as true.
 */
export function getCapabilities(scopes: AgentTokenScopes): AgentCapabilities {
  const tasks = scopes.tasks ?? {};
  const projects = scopes.projects ?? {};
  const goals = scopes.goals ?? {};

  const capabilities: AgentCapabilities = {
    tasks: {
      read: tasks.read ?? false,
      create: tasks.create ?? false,
      updateAny: tasks.updateAny ?? false,
      archive: tasks.archive ?? false,
      bulk: tasks.bulk ?? false,
    },
    projects: { read: projects.read ?? false },
    goals: { read: goals.read ?? false },
  };

  // Only include bulkLimit and idempotency in the response if they are present
  if (typeof tasks.bulkLimit === "number") {
    capabilities.tasks.bulkLimit = tasks.bulkLimit;
  }
  if (typeof tasks.idempotency === "string") {
    capabilities.tasks.idempotency = tasks.idempotency;
  }

  return capabilities;
}
