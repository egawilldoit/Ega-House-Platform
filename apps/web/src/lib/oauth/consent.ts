export type OAuthConsentDecision = "approve" | "deny";

export type NormalizedAuthorizationDetails = {
  authorizationId: string;
  clientId: string;
  clientName: string;
  redirectUri: string | null;
  scopes: string[];
};

const MAX_AUTHORIZATION_ID_LENGTH = 2048;
const MAX_CLIENT_ID_LENGTH = 2048;
const MAX_CLIENT_NAME_LENGTH = 256;
const MAX_REDIRECT_URI_LENGTH = 4096;
const MAX_SCOPE_LENGTH = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoundedString(
  value: unknown,
  maximumLength: number,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength) return null;
  return normalized;
}

export function parseAuthorizationId(value: unknown): string {
  const authorizationId = readBoundedString(
    value,
    MAX_AUTHORIZATION_ID_LENGTH,
  );

  if (!authorizationId) {
    throw new Error("Invalid OAuth authorization request.");
  }

  return authorizationId;
}

export function buildConsentLoginPath(authorizationId: string): string {
  const normalizedId = parseAuthorizationId(authorizationId);
  const continuation = `/oauth/consent?authorization_id=${encodeURIComponent(normalizedId)}`;
  return `/login?next=${encodeURIComponent(continuation)}`;
}

export function parseRequestedScopes(value: unknown): string[] {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value !== "string" || value.length > MAX_SCOPE_LENGTH) {
    throw new Error("Invalid OAuth authorization details.");
  }

  const scopes = value
    .split(/\s+/u)
    .map((scope) => scope.trim())
    .filter(Boolean);

  if (scopes.some((scope) => scope.length > 256)) {
    throw new Error("Invalid OAuth authorization details.");
  }

  return [...new Set(scopes)];
}

export function normalizeAuthorizationDetails(
  value: unknown,
): NormalizedAuthorizationDetails {
  if (!isRecord(value)) {
    throw new Error("Invalid OAuth authorization details.");
  }

  const client = isRecord(value.client) ? value.client : {};
  const authorizationId = readBoundedString(
    value.authorization_id,
    MAX_AUTHORIZATION_ID_LENGTH,
  );
  const clientId =
    readBoundedString(value.client_id, MAX_CLIENT_ID_LENGTH)
    ?? readBoundedString(client.client_id, MAX_CLIENT_ID_LENGTH)
    ?? readBoundedString(client.id, MAX_CLIENT_ID_LENGTH);

  if (!authorizationId || !clientId) {
    throw new Error("Invalid OAuth authorization details.");
  }

  const clientName =
    readBoundedString(client.name, MAX_CLIENT_NAME_LENGTH)
    ?? readBoundedString(value.client_name, MAX_CLIENT_NAME_LENGTH)
    ?? "Unknown OAuth client";
  const redirectUri = readBoundedString(
    value.redirect_uri,
    MAX_REDIRECT_URI_LENGTH,
  );

  return {
    authorizationId,
    clientId,
    clientName,
    redirectUri,
    scopes: parseRequestedScopes(value.scope),
  };
}

export function parseConsentDecision(value: unknown): OAuthConsentDecision {
  if (value === "approve" || value === "deny") return value;
  throw new Error("Invalid OAuth consent decision.");
}

export function requireSameOrigin(request: Request): void {
  const requestOrigin = new URL(request.url).origin;
  const submittedOrigin = request.headers.get("origin");

  if (submittedOrigin !== requestOrigin) {
    throw new Error("Invalid OAuth consent origin.");
  }
}
