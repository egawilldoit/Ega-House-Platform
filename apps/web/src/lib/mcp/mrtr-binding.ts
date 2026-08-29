export type McpMutationBinding = {
  user: string;
  client: string;
  grantId: string;
  grantVersion: number;
  resource: string;
  tool: string;
  operationId: string;
  argsHash: string;
  phase: string;
  targetDate?: string;
  targetId?: string;
};

export type McpMutationCurrent = {
  principal: {
    ownerUserId: string;
    oauthClientId: string;
    grantId: string;
    permissionsVersion: number;
  };
  resource: string;
  tool: string;
  operationId: string;
  argsHash: string;
  expectedPhase: string;
  targetDate?: string;
  targetId?: string;
};

export class McpMutationStateError extends Error {
  constructor(
    public code: "STATE_MISMATCH" | "STATE_EXPIRED" | "STATE_MISSING",
    message: string,
  ) {
    super(message);
    this.name = "McpMutationStateError";
  }
}

export function mintMcpMutationState(
  codec: { mint(payload: McpMutationBinding): Promise<string> },
  binding: McpMutationBinding,
): Promise<string> {
  return codec.mint(binding);
}

function assertFieldMatches(
  state: Record<string, unknown>,
  field: string,
  expected: unknown,
): void {
  if (state[field] !== expected) {
    throw new McpMutationStateError("STATE_MISMATCH", `Verified requestState field "${field}" does not match the current request.`);
  }
}

export function assertVerifiedMcpMutationState(
  current: McpMutationCurrent,
  verifiedState: unknown,
): void {
  if (verifiedState === null || verifiedState === undefined) {
    throw new McpMutationStateError("STATE_MISSING", "Verified requestState is missing for the confirmed mutation.");
  }
  const state = verifiedState as Record<string, unknown>;
  assertFieldMatches(state, "user", current.principal.ownerUserId);
  assertFieldMatches(state, "client", current.principal.oauthClientId);
  assertFieldMatches(state, "grantId", current.principal.grantId);
  assertFieldMatches(state, "grantVersion", current.principal.permissionsVersion);
  assertFieldMatches(state, "resource", current.resource);
  assertFieldMatches(state, "tool", current.tool);
  assertFieldMatches(state, "operationId", current.operationId);
  assertFieldMatches(state, "argsHash", current.argsHash);
  assertFieldMatches(state, "phase", current.expectedPhase);
  if (current.targetDate !== undefined) {
    assertFieldMatches(state, "targetDate", current.targetDate);
  }
  if (current.targetId !== undefined) {
    assertFieldMatches(state, "targetId", current.targetId);
  }
}
