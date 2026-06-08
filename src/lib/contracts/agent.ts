// Types only — no runtime exports. Zero dependencies.
// This module can be imported anywhere without side effects.

export type AgentTokenScopes = {
  tasks?: {
    read?: boolean;
    create?: boolean;
    updateAny?: boolean;
    archive?: boolean;
    bulk?: boolean;
    bulkLimit?: number;
    idempotency?: string;
  };
  projects?: {
    read?: boolean;
  };
  goals?: {
    read?: boolean;
  };
};

export type AgentAuthContext = {
  tokenId: string;
  ownerUserId: string;
  scopes: AgentTokenScopes;
};

export type AgentCapabilities = {
  tasks: {
    read: boolean;
    create: boolean;
    updateAny: boolean;
    archive: boolean;
    bulk: boolean;
    bulkLimit?: number;
    idempotency?: string;
  };
  projects: { read: boolean };
  goals: { read: boolean };
};

export type AgentCapabilitiesResponse = {
  ok: true;
  agent: string;
  capabilities: AgentCapabilities;
};

export type AgentErrorCode = "UNAUTHENTICATED" | "INTERNAL_ERROR";

export type AgentErrorResponse = {
  ok: false;
  error: {
    code: AgentErrorCode;
    message: string;
  };
};

export type AgentAuthSuccess = {
  ok: true;
  context: AgentAuthContext;
};

export type AgentAuthFailure = {
  ok: false;
  response: AgentErrorResponse;
  status: 401 | 500;
};

export type AgentAuthResult = AgentAuthSuccess | AgentAuthFailure;

export const INTERNAL_ERROR_RESPONSE: AgentErrorResponse = {
  ok: false,
  error: {
    code: "INTERNAL_ERROR",
    message: "The request could not be completed.",
  },
};

export type TokenRecord = {
  id: string;
  ownerUserId: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopes: AgentTokenScopes;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewTokenRecord = {
  ownerUserId: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopes: AgentTokenScopes;
};
