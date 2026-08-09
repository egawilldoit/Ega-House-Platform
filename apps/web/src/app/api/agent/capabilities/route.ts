// Production route handler for GET /api/agent/capabilities.
// Imports @/db/client for the production DrizzleTokenRepository.
// The handler logic is in @/lib/http/agent-capabilities-handler for testability.

import { after } from "next/server";

import { db } from "@/db/client";
import { DrizzleTokenRepository } from "@/lib/services/agent-token-repository";
import {
  createCapabilitiesHandler,
  type TelemetryFn,
} from "@/lib/http/agent-capabilities-handler";

// Module-level repository singleton — reused across requests.
const repo = new DrizzleTokenRepository(db);

// Schedule last_used_at update after the response is sent.
// Failure is logged but never affects the response.
const telemetry: TelemetryFn = async (tokenId) => {
  after(async () => {
    try {
      await repo.updateLastUsedAt(tokenId);
    } catch (err) {
      console.warn(
        "[agent-capabilities] last_used_at update failed:",
        (err as Error)?.message ?? err,
      );
    }
  });
};

export const GET = createCapabilitiesHandler(repo, telemetry);
