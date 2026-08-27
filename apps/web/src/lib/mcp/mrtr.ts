import type { AuthInfo, ServerContext } from "@modelcontextprotocol/server";

import { createRequestStateCodec } from "@/lib/mcp/request-state";
import { hasMcpPermission } from "@/lib/mcp/permissions";
import { readPrincipalFromAuthInfo } from "@/lib/mcp/auth-info";

export type ClearCompletedTodayState = {
  user: string;
  client: string;
  grantId: string;
  grantVersion: number;
  resource: string;
  tool: "ega_clear_completed_today";
  operationId: string;
  argsHash: string;
  targetDate: string;
  phase: "awaiting_confirmation";
};

export function getRequestStateSecret(): string {
  const secret = process.env.MCP_REQUEST_STATE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("MCP_REQUEST_STATE_SECRET must be set (32+ bytes).");
  }
  return secret;
}

export function createClearCompletedCodec() {
  return createRequestStateCodec<ClearCompletedTodayState>({
    key: getRequestStateSecret(),
    ttlSeconds: 300,
  });
}

// Example handler shape for docs; actual wiring via inputRequired helper from @modelcontextprotocol/server
export async function handleClearCompletedToday(
  authInfo: AuthInfo | undefined,
  input: { date: string; operationId: string; confirmed?: boolean },
  ctx: ServerContext,
): Promise<unknown> {
  const principal = readPrincipalFromAuthInfo(authInfo!);
  if (!hasMcpPermission(principal.permissions, "today.update")) {
    throw new Error("PERMISSION_DENIED");
  }
  // TOCTOU: revalidate grant/version between rounds via ctx.mcpReq.requestState
  // On first call, confirmed is undefined → mint state and return input_required
  // On second call, verify state, check grant still active, target unchanged, then mutate
  return { ok: true, date: input.date, operationId: input.operationId, principal: principal.ownerUserId, ctx };
}
