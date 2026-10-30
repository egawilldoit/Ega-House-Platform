// Repository interface and Drizzle implementation for agent tokens.
// Does NOT import server-only — this module is shared between the
// Next.js production route (which has its own server-only boundary)
// and the standalone CLI.

import { and, desc, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { agentActors, agentIntegrationTokens } from "@/db/schema";
import type { NewTokenRecord, TokenRecord } from "@/lib/contracts/agent";
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
      .leftJoin(agentActors, eq(agentIntegrationTokens.agentId, agentActors.id))
      .where(eq(agentIntegrationTokens.tokenPrefix, prefix))
      .limit(1);

    if (rows.length === 0) return null;
    return mapRowToRecord(
      rows[0].agent_integration_tokens,
      rows[0].agent_actors?.displayName ?? null,
    );
  }

  async insertToken(record: NewTokenRecord): Promise<string> {
    const rows = await this.db
      .insert(agentIntegrationTokens)
      .values({
        ownerUserId: record.ownerUserId,
        agentId: record.agentId ?? null,
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

  /** Owner-scoped credential list for the agent registry. */
  async listByOwner(ownerUserId: string): Promise<TokenRecord[]> {
    const rows = await this.db
      .select()
      .from(agentIntegrationTokens)
      .leftJoin(agentActors, eq(agentIntegrationTokens.agentId, agentActors.id))
      .where(eq(agentIntegrationTokens.ownerUserId, ownerUserId))
      .orderBy(desc(agentIntegrationTokens.createdAt));

    return rows.map((row) =>
      mapRowToRecord(
        row.agent_integration_tokens,
        row.agent_actors?.displayName ?? null,
      ),
    );
  }

  async findByIdForOwner(id: string, ownerUserId: string): Promise<TokenRecord | null> {
    const rows = await this.db
      .select()
      .from(agentIntegrationTokens)
      .leftJoin(agentActors, eq(agentIntegrationTokens.agentId, agentActors.id))
      .where(
        and(
          eq(agentIntegrationTokens.id, id),
          eq(agentIntegrationTokens.ownerUserId, ownerUserId),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;
    return mapRowToRecord(
      rows[0].agent_integration_tokens,
      rows[0].agent_actors?.displayName ?? null,
    );
  }

  /** Revoke every active credential of one actor; returns how many changed. */
  async revokeActiveForAgent(agentId: string, ownerUserId: string): Promise<number> {
    const rows = await this.db
      .update(agentIntegrationTokens)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(agentIntegrationTokens.agentId, agentId),
          eq(agentIntegrationTokens.ownerUserId, ownerUserId),
          isNull(agentIntegrationTokens.revokedAt),
        ),
      )
      .returning({ id: agentIntegrationTokens.id });

    return rows.length;
  }
}

// ---- Row mapping ----

type DbRow = {
  id: string;
  ownerUserId: string;
  agentId: string | null;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopes: unknown;
  lastUsedAt: Date | string | null;
  revokedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function mapRowToRecord(row: DbRow, agentName: string | null): TokenRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    agentId: row.agentId ?? null,
    agentName,
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
