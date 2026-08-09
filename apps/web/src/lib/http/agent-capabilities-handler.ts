// Testable HTTP handler for the agent capabilities endpoint.
// Does NOT import @/db/client — accepts TokenRepository via DI.
// Tests import this module directly with mock repositories.

import { NextResponse } from "next/server";

import type { TokenRepository } from "@/lib/services/agent-token-repository";
import { resolveAgentAuth, getCapabilities } from "@/lib/services/agent-token-service";
import {
  INTERNAL_ERROR_RESPONSE,
  type AgentCapabilitiesResponse,
} from "@/lib/contracts/agent";

const AGENT_NAME = "ega-house";

export type TelemetryFn = (tokenId: string) => Promise<void>;

export function createCapabilitiesHandler(
  repo: TokenRepository,
  telemetry?: TelemetryFn,
) {
  return async function GET(request: Request) {
    try {
      const auth = await resolveAgentAuth(request, repo);

      if (!auth.ok) {
        return NextResponse.json(auth.response, { status: auth.status });
      }

      // Best-effort telemetry at the application boundary.
      // Must never block or change the response.
      if (telemetry) {
        telemetry(auth.context.tokenId).catch((err: unknown) => {
          console.warn(
            "[agent-capabilities] telemetry failed:",
            (err as Error)?.message ?? err,
          );
        });
      }

      const response: AgentCapabilitiesResponse = {
        ok: true,
        agent: AGENT_NAME,
        capabilities: getCapabilities(auth.context.scopes),
      };

      return NextResponse.json(response, { status: 200 });
    } catch (err) {
      // Configuration errors (missing pepper), DB failures, and unexpected
      // errors are thrown by resolveAgentAuth and caught here.
      console.error("[agent-capabilities] internal error:", (err as Error)?.message ?? err);

      return NextResponse.json(INTERNAL_ERROR_RESPONSE, { status: 500 });
    }
  };
}
