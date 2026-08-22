import type {
  MobileAuthRefreshResponse,
  MobileAuthSessionResponse,
} from '@/types/auth';
import { mobileApiFetch } from '@/lib/api/client';

export type MobileLoginInput = {
  email: string;
  password: string;
};

export async function loginMobile(
  input: MobileLoginInput,
): Promise<MobileAuthSessionResponse> {
  return mobileApiFetch<MobileAuthSessionResponse>('/api/auth/session', {
    method: 'POST',
    auth: false,
    body: JSON.stringify(input),
  });
}

export async function refreshMobileSession(
  refreshToken: string,
): Promise<MobileAuthRefreshResponse> {
  return mobileApiFetch<MobileAuthRefreshResponse>('/api/auth/refresh', {
    method: 'POST',
    auth: false,
    body: JSON.stringify({ refreshToken }),
  });
}

export async function logoutMobileSession() {
  return mobileApiFetch('/api/auth/logout', {
    method: 'POST',
    auth: true,
    retryOnUnauthorized: false,
  });
}
