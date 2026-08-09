/**
 * Mobile binding for the platform-neutral @ega/api-client transport.
 *
 * The client (packages/api-client) owns no session state: it asks an
 * injected token provider for the Authorization header on every /api/*
 * request. This module supplies that provider from the mobile-owned
 * session layer (the same handlers AuthProvider configures in
 * `lib/api/client.ts`) and exposes a lazily-created singleton so feature
 * wrappers (`lib/api/projects.ts`, `lib/api/goals.ts`) stay thin.
 *
 * Mobile architecture rules (mobile-no-application / mobile-no-data-access
 * / mobile-no-server / mobile-no-db) are respected: this layer only ever
 * talks to the typed HTTP client — never to application, data-access, or
 * database internals.
 */
import {
  createEgaApiClient,
  type ApiResult,
  type EgaApiClient,
} from '@ega/api-client';
import {
  getApiBaseUrl,
  getMobileSessionAccessToken,
  refreshMobileSessionIfConfigured,
} from '@/lib/api/client';

let mobileEgaClient: EgaApiClient | null = null;

/**
 * Lazily-created singleton client bound to the mobile API base URL and the
 * mobile session token provider.
 */
export function getMobileEgaApiClient(): EgaApiClient {
  if (!mobileEgaClient) {
    mobileEgaClient = createEgaApiClient({
      baseUrl: getApiBaseUrl(),
      getAccessToken: () => getMobileSessionAccessToken(),
      onAuthError: () => {
        // The mobile session layer owns refresh/expiry handling; trigger a
        // best-effort refresh so the next request carries a fresh token.
        // The failed request still surfaces its UNAUTHENTICATED result.
        refreshMobileSessionIfConfigured().catch(() => {
          // Best-effort; the query layer reports the error either way.
        });
      },
    });
  }

  return mobileEgaClient;
}

/**
 * Test seam: replace the singleton (pass `null` to reset so the next call
 * rebuilds a real client). Keeps wrapper unit tests free of network access.
 */
export function setMobileEgaApiClientForTesting(client: EgaApiClient | null) {
  mobileEgaClient = client;
}

/**
 * Unwrap a typed ApiResult, throwing the server's message when the call
 * failed. Mirrors the legacy mobile layer, which throws `Error` with the
 * server message for non-2xx responses.
 */
export function unwrapApiResult<T>(result: ApiResult<T>): T {
  if (result.ok) {
    return result.data;
  }

  throw new Error(result.error.message);
}
