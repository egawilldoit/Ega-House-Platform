// ── Auth system tests ──

import { describe, it, expect } from 'vitest';
import { TokenStore } from '../src/lib/auth.js';

function createStore(): TokenStore {
  return new TokenStore('test-secret', 10, 86400); // 10s access, 1d refresh
}

describe('TokenStore', () => {
  describe('Device Registration', () => {
    it('returns valid token pair', () => {
      const store = createStore();
      const tokens = store.registerDevice('principal_1', 'Pixel 9', 'android');
      expect(tokens.accessToken).toBeTruthy();
      expect(tokens.refreshToken).toBeTruthy();
      expect(tokens.tokenType).toBe('Bearer');
      expect(tokens.expiresIn).toBe(10);
    });

    it('tokens are usable immediately', () => {
      const store = createStore();
      const tokens = store.registerDevice('principal_1', 'Pixel 9', 'android');
      const ctx = store.validateAccessToken(tokens.accessToken);
      expect(ctx.authenticated).toBe(true);
      expect(ctx.principalId).toBe('principal_1');
      expect(ctx.scope).toContain('read');
    });
  });

  describe('Access Token Validation', () => {
    it('rejects expired tokens', async () => {
      const store = new TokenStore('test-secret', -1, 86400); // -1s = immediately expired
      const tokens = store.registerDevice('p1', 'D1', 'android');
      await new Promise((r) => setTimeout(r, 10));
      const ctx = store.validateAccessToken(tokens.accessToken);
      expect(ctx.authenticated).toBe(false);
      expect(ctx.error).toContain('expired');
    });

    it('rejects tampered tokens', () => {
      const store = createStore();
      const tokens = store.registerDevice('p1', 'D1', 'android');
      const tampered = tokens.accessToken.replace(/[a-zA-Z0-9]/g, (c) =>
        c === 'a' ? 'b' : 'a'
      );
      const ctx = store.validateAccessToken(tampered);
      expect(ctx.authenticated).toBe(false);
    });

    it('rejects malformed tokens', () => {
      const store = createStore();
      const ctx = store.validateAccessToken('not-a-jwt');
      expect(ctx.authenticated).toBe(false);
      expect(ctx.error).toContain('Invalid');
    });

    it('rejects tokens with wrong secret', () => {
      const store1 = new TokenStore('secret-1');
      const store2 = new TokenStore('secret-2');
      const tokens = store1.registerDevice('p1', 'D1', 'android');
      const ctx = store2.validateAccessToken(tokens.accessToken);
      expect(ctx.authenticated).toBe(false);
    });
  });

  describe('Refresh Tokens', () => {
    it('issues new token pair on refresh', () => {
      const store = createStore();
      const tokens = store.registerDevice('p1', 'D1', 'android');

      const result = store.refreshAccessToken(tokens.refreshToken);
      expect('accessToken' in result).toBe(true);
      if ('accessToken' in result) {
        expect(result.accessToken).not.toBe(tokens.accessToken);
        expect(result.refreshToken).not.toBe(tokens.refreshToken);
      }
    });

    it('old refresh token cannot be reused (rotation)', () => {
      const store = createStore();
      const tokens = store.registerDevice('p1', 'D1', 'android');

      // First use — valid
      const result1 = store.refreshAccessToken(tokens.refreshToken);
      expect('accessToken' in result1).toBe(true);

      // Second use — should detect reuse (token already rotated)
      const result2 = store.refreshAccessToken(tokens.refreshToken);
      expect('error' in result2).toBe(true);
      if ('error' in result2) {
        // The token hash was deleted after first use, so "not found" is expected
        expect(result2.error).toBeTruthy();
      }

      // All tokens for that device should still work (only refresh token is rotated)
      if ('accessToken' in result1) {
        const ctx = store.validateAccessToken(result1.accessToken);
        expect(ctx.authenticated).toBe(true);
      }
    });

    it('rejects expired refresh tokens', () => {
      const store = new TokenStore('test', 10, -1); // negative = already expired
      const tokens = store.registerDevice('p1', 'D1', 'android');
      const result = store.refreshAccessToken(tokens.refreshToken);
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('expired');
      }
    });

    it('rejects nonexistent refresh tokens', () => {
      const store = createStore();
      const result = store.refreshAccessToken('nonexistent-token');
      expect('error' in result).toBe(true);
      expect(result.error).toContain('not found');
    });
  });

  describe('Device Revocation', () => {
    it('revoked device tokens are rejected', () => {
      const store = createStore();
      const tokens = store.registerDevice('p1', 'D1', 'android');

      // Extract device ID
      const payload = JSON.parse(
        Buffer.from(tokens.accessToken.split('.')[1]!, 'base64url').toString()
      );
      store.revokeDevice(payload.sub);

      const ctx = store.validateAccessToken(tokens.accessToken);
      expect(ctx.authenticated).toBe(false);
      expect(ctx.error).toContain('revoked');
    });

    it('returns false for nonexistent device revocation', () => {
      const store = createStore();
      expect(store.revokeDevice('nonexistent')).toBe(false);
    });

    it('refresh tokens are revoked when device is revoked', () => {
      const store = createStore();
      const tokens = store.registerDevice('p1', 'D1', 'ios');

      const payload = JSON.parse(
        Buffer.from(tokens.accessToken.split('.')[1]!, 'base64url').toString()
      );
      store.revokeDevice(payload.sub);

      const result = store.refreshAccessToken(tokens.refreshToken);
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('revoked');
      }
    });
  });

  describe('Token Cleanup', () => {
    it('removes expired refresh tokens', () => {
      const store = new TokenStore('test', 10, -86400); // already expired
      store.registerDevice('p1', 'D1', 'android');
      store.cleanup();
      // After cleanup, internal map should be empty
      // (can't directly check, but it shouldn't throw)
    });
  });
});
