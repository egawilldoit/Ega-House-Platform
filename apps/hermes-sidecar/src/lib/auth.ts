// ── Authentication system ──
// Uses HMAC-SHA256 signed tokens (no external JWT library needed).
// Tokens: 10-min access, 30-day refresh. Refresh tokens stored as SHA-256 hashes.
// Device revocation: in-memory set of revoked device IDs.
// All state is in-memory (mock/test mode).

import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';

// ── Types ──

export interface TokenPayload {
  jti: string;            // unique token ID (prevents identical tokens)
  sub: string;            // device_id
  principal_id: string;
  scope: string[];
  iat: number;            // issued at (epoch seconds)
  exp: number;            // expires at (epoch seconds)
}

export interface AuthContext {
  authenticated: boolean;
  deviceId: string | null;
  principalId: string | null;
  scope: string[];
  tokenExp: number | null;
  error?: string;
}

export interface DeviceInfo {
  id: string;
  principalId: string;
  deviceName: string;
  platform: 'android' | 'ios';
  pushToken?: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

interface StoredRefreshToken {
  deviceId: string;
  tokenHash: string;
  expiresAt: number;
  revokedAt: number | null;
}

// ── Token Store ──

export class TokenStore {
  private devices = new Map<string, DeviceInfo>();
  private refreshTokens = new Map<string, StoredRefreshToken>();
  private revokedDevices = new Set<string>();
  private deviceCounter = 0;
  private jwtSecret: string;
  private accessTokenExpirySec: number;
  private refreshTokenExpirySec: number;

  constructor(jwtSecret?: string, accessExpirySec = 600, refreshExpirySec = 30 * 86400) {
    this.jwtSecret = jwtSecret || 'dev-jwt-secret-do-not-use-in-production';
    this.accessTokenExpirySec = accessExpirySec;
    this.refreshTokenExpirySec = refreshExpirySec;
  }

  // ── Device Registration ──

  registerDevice(
    principalId: string,
    deviceName: string,
    platform: 'android' | 'ios',
    pushToken?: string
  ): TokenPair & { device_id: string } {
    this.deviceCounter++;
    const deviceId = `dev_${Date.now()}_${this.deviceCounter}`;
    const now = Date.now();

    const device: DeviceInfo = {
      id: deviceId,
      principalId,
      deviceName,
      platform,
      pushToken,
      createdAt: now,
      lastSeenAt: now,
    };
    this.devices.set(deviceId, device);

    const tokens = this.generateTokenPair(deviceId, principalId);
    return { ...tokens, device_id: deviceId };
  }

  // ── Token Generation ──

  generateTokenPair(deviceId: string, principalId: string): TokenPair {
    const now = Math.floor(Date.now() / 1000);

    // Access token (JWT-like, HMAC-signed)
    const accessPayload: TokenPayload = {
      jti: randomBytes(8).toString('hex'),
      sub: deviceId,
      principal_id: principalId,
      scope: ['read', 'mobile'],
      iat: now,
      exp: now + this.accessTokenExpirySec,
    };
    const accessToken = this.signToken(accessPayload);

    // Refresh token (random value, stored as hash)
    const refreshTokenRaw = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(refreshTokenRaw).digest('hex');

    this.refreshTokens.set(tokenHash, {
      deviceId,
      tokenHash,
      expiresAt: Date.now() + this.refreshTokenExpirySec * 1000,
      revokedAt: null,
    });

    return {
      accessToken,
      refreshToken: refreshTokenRaw,
      expiresIn: this.accessTokenExpirySec,
      tokenType: 'Bearer',
    };
  }

  // ── Token Validation ──

  validateAccessToken(token: string): AuthContext {
    const payload = this.verifyToken(token);
    if (!payload) {
      return {
        authenticated: false,
        deviceId: null,
        principalId: null,
        scope: [],
        tokenExp: null,
        error: 'Invalid or expired access token',
      };
    }

    // Check if device is revoked
    if (this.revokedDevices.has(payload.sub)) {
      return {
        authenticated: false,
        deviceId: null,
        principalId: null,
        scope: [],
        tokenExp: null,
        error: 'Device has been revoked',
      };
    }

    // Check if device still exists
    if (!this.devices.has(payload.sub)) {
      return {
        authenticated: false,
        deviceId: null,
        principalId: null,
        scope: [],
        tokenExp: null,
        error: 'Device not found',
      };
    }

    // Update last seen
    const device = this.devices.get(payload.sub)!;
    device.lastSeenAt = Date.now();

    return {
      authenticated: true,
      deviceId: payload.sub,
      principalId: payload.principal_id,
      scope: payload.scope,
      tokenExp: payload.exp,
    };
  }

  refreshAccessToken(refreshTokenRaw: string): TokenPair | { error: string } {
    const tokenHash = createHash('sha256').update(refreshTokenRaw).digest('hex');
    const stored = this.refreshTokens.get(tokenHash);

    if (!stored) {
      return { error: 'Refresh token not found' };
    }

    if (stored.revokedAt) {
      // Token reuse detected! Revoke all tokens for this device
      this.revokeDevice(stored.deviceId);
      return { error: 'Refresh token has been revoked — device access revoked due to suspected token theft' };
    }

    if (Date.now() > stored.expiresAt) {
      this.refreshTokens.delete(tokenHash);
      return { error: 'Refresh token has expired' };
    }

    // Rotate: revoke old, issue new
    this.refreshTokens.delete(tokenHash);

    const device = this.devices.get(stored.deviceId);
    if (!device) {
      return { error: 'Device not found' };
    }

    return this.generateTokenPair(stored.deviceId, device.principalId);
  }

  // ── Device Revocation ──

  revokeDevice(deviceId: string): boolean {
    if (!this.devices.has(deviceId)) return false;
    this.revokedDevices.add(deviceId);

    // Revoke all refresh tokens for this device
    for (const [hash, stored] of this.refreshTokens) {
      if (stored.deviceId === deviceId) {
        stored.revokedAt = Date.now();
      }
    }

    return true;
  }

  getDevice(deviceId: string): DeviceInfo | undefined {
    return this.devices.get(deviceId);
  }

  isRevoked(deviceId: string): boolean {
    return this.revokedDevices.has(deviceId);
  }

  // ── Cleanup expired tokens ──

  cleanup(): void {
    const now = Date.now();
    for (const [hash, stored] of this.refreshTokens) {
      if (now > stored.expiresAt) {
        this.refreshTokens.delete(hash);
      }
    }
  }

  // ── JWT Helpers ──

  private signToken(payload: TokenPayload): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.jwtSecret)
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  private verifyToken(token: string): TokenPayload | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, bodyB64, sigB64] = parts;

    // Verify signature
    const expectedSig = createHmac('sha256', this.jwtSecret)
      .update(`${headerB64}.${bodyB64}`)
      .digest('base64url');

    if (!timingSafeEqual(Buffer.from(sigB64!), Buffer.from(expectedSig))) {
      return null;
    }

    // Parse payload
    let payload: TokenPayload;
    try {
      payload = JSON.parse(Buffer.from(bodyB64!, 'base64url').toString());
    } catch {
      return null;
    }

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }

    return payload;
  }
}
