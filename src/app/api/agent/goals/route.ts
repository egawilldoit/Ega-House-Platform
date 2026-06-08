// Production route handler for GET /api/agent/goals.
// Imports @/db/client for the production DrizzleTokenRepository.
// The handler logic is in @/lib/http/agent-task-handlers for testability.

import { after } from "next/server";

import { db } from "@/db/client";
import { DrizzleTokenRepository } from "@/lib/services/agent-token-repository";
import { AgentRateLimitService } from "@/lib/services/agent-rate-limit-service";
import {
  createReadHandlers,
  type TelemetryFn,
} from "@/lib/http/agent-task-handlers";

const repo = new DrizzleTokenRepository(db);

const rateLimiter = new AgentRateLimitService();

const telemetry: TelemetryFn = async (tokenId) => {
  after(async () => {
    try {
      await repo.updateLastUsedAt(tokenId);
    } catch (err) {
      console.warn(
        "[agent-goals] last_used_at update failed:",
        (err as Error)?.message ?? err,
      );
    }
  });
};

export const { GET_GOALS: GET } = createReadHandlers(repo, rateLimiter, telemetry);
