import type {
  MobileAuthRefreshResponse,
  MobileAuthSessionResponse,
} from '@/types/auth';

export type MobileLoginInput = {
  email: string;
  password: string;
};

export type MobileRefreshInput = {
  refreshToken: string;
};

export type MobileAuthApi = {
  login(input: MobileLoginInput): Promise<MobileAuthSessionResponse>;
  refresh(input: MobileRefreshInput): Promise<MobileAuthRefreshResponse>;
  logout(accessToken: string): Promise<void>;
};

async function readErrorMessage(response: Response) {
  const text = await response.text();
  return text || `Request failed with status ${response.status}`;
}

// Contract-only client for the auth model selected in docs/mobile-auth-decision.md.
// Endpoints are intentionally not implemented server-side yet.
export async function loginMobile(
  baseUrl: string,
  input: MobileLoginInput,
): Promise<MobileAuthSessionResponse> {
  const response = await fetch(`${baseUrl}/api/mobile/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as MobileAuthSessionResponse;
}

export async function refreshMobileSession(
  baseUrl: string,
  input: MobileRefreshInput,
): Promise<MobileAuthRefreshResponse> {
  const response = await fetch(`${baseUrl}/api/mobile/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as MobileAuthRefreshResponse;
}

export async function logoutMobileSession(baseUrl: string, accessToken: string) {
  const response = await fetch(`${baseUrl}/api/mobile/auth/logout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok && response.status !== 204) {
    throw new Error(await readErrorMessage(response));
  }
}
