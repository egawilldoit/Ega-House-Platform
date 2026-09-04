import {
  isMobileAuthRefreshResponse,
  isMobileAuthSessionResponse,
} from '@ega/contracts/mobile';
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
  const response = await mobileApiFetch<unknown>('/api/auth/session', {
    method: 'POST',
    auth: false,
    body: JSON.stringify(input),
  });

  if (!isMobileAuthSessionResponse(response)) {
    throw new Error('Authentication service returned an invalid session.');
  }

  return response;
}

export async function refreshMobileSession(
  refreshToken: string,
): Promise<MobileAuthRefreshResponse> {
  const response = await mobileApiFetch<unknown>('/api/auth/refresh', {
    method: 'POST',
    auth: false,
    body: JSON.stringify({ refreshToken }),
  });

  if (!isMobileAuthRefreshResponse(response)) {
    throw new Error('Authentication service returned an invalid refresh session.');
  }

  return response;
}

export async function logoutMobileSession() {
  return mobileApiFetch('/api/auth/logout', {
    method: 'POST',
    auth: true,
    retryOnUnauthorized: false,
  });
}
