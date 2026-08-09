// Repository interface and Drizzle implementation for agent tokens.
// Does NOT import server-only — this module is shared between the
// Next.js production route (which has its own server-only boundary)
// and the standalone CLI.

import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { agentIntegrationTokens } from "@/db/schema";
import type { AgentTokenScopes, NewTokenRecord, TokenRecord } from "@/lib/contracts/agent";
import { normalizeStoredScopes } from "@/lib/services/agent-token-scopes";
import * as schema from "@/db/schema";

// ---- Repository interface for dependency injection ----

export interface TokenRepository {
  findByPrefix(prefix: string): Promise<TokenRecord | null>;
  insertToken(record: NewTokenRecord): Promise<string>;
  updateLastUsedAt(id: string): Promise<void>;
  revokeToken(id: string): Promise<void>;
}

// ---- Production implementation using Drizzle with postgres-js ----

export class DrizzleTokenRepository implements TokenRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  async findByPrefix(prefix: string): Promise<TokenRecord | null> {
    const rows = await this.db
      .select()
      .from(agentIntegrationTokens)
      .where(eq(agentIntegrationTokens.tokenPrefix, prefix))
      .limit(1);

    if (rows.length === 0) return null;
    return mapRowToRecord(rows[0]);
  }

  async insertToken(record: NewTokenRecord): Promise<string> {
    const rows = await this.db
      .insert(agentIntegrationTokens)
      .values({
        ownerUserId: record.ownerUserId,
        name: record.name,
        tokenPrefix: record.tokenPrefix,
        tokenHash: record.tokenHash,
        scopes: record.scopes as Record<string, unknown>,
      })
      .returning({ id: agentIntegrationTokens.id });

    return rows[0].id;
  }

  async updateLastUsedAt(id: string): Promise<void> {
    await this.db
      .update(agentIntegrationTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(agentIntegrationTokens.id, id));
  }

  async revokeToken(id: string): Promise<void> {
    await this.db
      .update(agentIntegrationTokens)
      .set({ revokedAt: new Date() })
      .where(eq(agentIntegrationTokens.id, id));
  }
}

// ---- Row mapping ----

type DbRow = {
  id: string;
  ownerUserId: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopes: unknown;
  lastUsedAt: Date | string | null;
  revokedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function mapRowToRecord(row: DbRow): TokenRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    tokenHash: row.tokenHash,
    scopes: normalizeStoredScopes(row.scopes),
    lastUsedAt: serializeDate(row.lastUsedAt),
    revokedAt: serializeDate(row.revokedAt),
    createdAt: serializeDateRequired(row.createdAt),
    updatedAt: serializeDateRequired(row.updatedAt),
  };
}

function serializeDate(
  value: Date | string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}

function serializeDateRequired(value: Date | string): string {
  if (typeof value === "string") return value;
  return value.toISOString();
}
