import * as SecureStore from 'expo-secure-store';

import type { StoredMobileSession } from '@/types/auth';

export interface MobileSessionStorage {
  getSession(): Promise<StoredMobileSession | null>;
  setSession(session: StoredMobileSession): Promise<void>;
  clearSession(): Promise<void>;
}

type StoredSessionShape = {
  session: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  };
  user: {
    id: string;
    email: string;
  };
};

function isStoredSessionShape(value: unknown): value is StoredSessionShape {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const session = candidate.session as Record<string, unknown> | undefined;
  const user = candidate.user as Record<string, unknown> | undefined;

  return (
    !!session &&
    !!user &&
    typeof session.accessToken === 'string' &&
    typeof session.refreshToken === 'string' &&
    typeof session.expiresAt === 'number' &&
    typeof user.id === 'string' &&
    typeof user.email === 'string'
  );
}

export function parseStoredSession(value: unknown): StoredMobileSession | null {
  if (!isStoredSessionShape(value)) {
    return null;
  }

  return {
    session: {
      accessToken: value.session.accessToken,
      refreshToken: value.session.refreshToken,
      expiresAt: value.session.expiresAt,
    },
    user: {
      id: value.user.id,
      email: value.user.email,
    },
  };
}

export class InMemorySessionStorage implements MobileSessionStorage {
  private session: StoredMobileSession | null = null;

  async getSession() {
    return this.session;
  }

  async setSession(session: StoredMobileSession) {
    this.session = session;
  }

  async clearSession() {
    this.session = null;
  }
}

const SESSION_STORAGE_KEY = 'ega.mobile.session';

class SecureStoreSessionStorage implements MobileSessionStorage {
  async getSession() {
    try {
      const raw = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
      if (!raw) {
        return null;
      }

      return parseStoredSession(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async setSession(session: StoredMobileSession) {
    await SecureStore.setItemAsync(SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  async clearSession() {
    await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
  }
}

const fallbackStorage = new InMemorySessionStorage();
const secureStorage = new SecureStoreSessionStorage();

export const mobileSessionStorage: MobileSessionStorage = {
  async getSession() {
    const secureSession = await secureStorage.getSession();
    if (secureSession) {
      return secureSession;
    }

    return fallbackStorage.getSession();
  },
  async setSession(session) {
    await Promise.all([secureStorage.setSession(session), fallbackStorage.setSession(session)]);
  },
  async clearSession() {
    await Promise.all([secureStorage.clearSession(), fallbackStorage.clearSession()]);
  },
};
