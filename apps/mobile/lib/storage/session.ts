import type { MobileAuthSession } from '@/types/auth';

export interface MobileSessionStorage {
  getSession(): Promise<MobileAuthSession | null>;
  setSession(session: MobileAuthSession): Promise<void>;
  clearSession(): Promise<void>;
}

type StoredSessionShape = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

function isStoredSessionShape(value: unknown): value is StoredSessionShape {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.accessToken === 'string' &&
    typeof candidate.refreshToken === 'string' &&
    typeof candidate.expiresAt === 'number'
  );
}

export function parseStoredSession(value: unknown): MobileAuthSession | null {
  if (!isStoredSessionShape(value)) {
    return null;
  }

  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    expiresAt: value.expiresAt,
  };
}

export class InMemorySessionStorage implements MobileSessionStorage {
  private session: MobileAuthSession | null = null;

  async getSession() {
    return this.session;
  }

  async setSession(session: MobileAuthSession) {
    this.session = session;
  }

  async clearSession() {
    this.session = null;
  }
}

// TODO(EGA-Next): Replace with Expo SecureStore-backed implementation.
// Keep this non-persistent fallback so current temporary auth shell stays functional.
export const mobileSessionStorage: MobileSessionStorage = new InMemorySessionStorage();
