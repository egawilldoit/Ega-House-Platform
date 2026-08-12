/**
 * Mobile binding for the platform-neutral @ega/api-client transport.
 *
 * The client owns no session state: it asks the mobile-owned session layer
 * for the current access token and, after an authenticated 401, may invoke
 * the mobile-owned refresh operation exactly once before retrying.
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
 * mobile session token/refresh providers.
 */
export function getMobileEgaApiClient(): EgaApiClient {
  if (!mobileEgaClient) {
    mobileEgaClient = createEgaApiClient({
      baseUrl: getApiBaseUrl(),
      getAccessToken: () => getMobileSessionAccessToken(),
      refreshAccessToken: () => refreshMobileSessionIfConfigured(),
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
