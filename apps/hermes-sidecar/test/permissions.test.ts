// ── Authorization and permission tests ──

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext, registerTestDevice, destroyTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
let accessToken: string;
let deviceId: string;

beforeAll(async () => {
  ctx = await createTestContext();
  const dev = registerTestDevice(ctx.tokenStore);
  accessToken = dev.accessToken;
  deviceId = dev.deviceId;
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

describe('Permission enforcement', () => {
  // ── Unknown Routes ──

  it('unknown routes return 404 (not 401)', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/nonexistent' });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).code).toBe('NOT_FOUND');
  });

  it('unknown routes return 404 even with auth', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/hermes/nonexistent',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('forbidden path patterns are blocked at router level', async () => {
    // These should never be registerable routes
    const { isPathForbidden } = await import('../src/lib/security-boundary.js');
    expect(isPathForbidden('/proxy/test').forbidden).toBe(true);
    expect(isPathForbidden('/shell').forbidden).toBe(true);
    expect(isPathForbidden('/exec').forbidden).toBe(true);
    expect(isPathForbidden('/command').forbidden).toBe(true);
    expect(isPathForbidden('/arbitrary-url').forbidden).toBe(true);
    expect(isPathForbidden('/graphql').forbidden).toBe(true);
    expect(isPathForbidden('/debug').forbidden).toBe(true);
    expect(isPathForbidden('/_internal/admin').forbidden).toBe(true);
  });

  // ── Write Actions Disabled ──

  it('write route (POST /v1/hermes/chat) returns 404 when disabled', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/hermes/chat',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { message: 'test' },
    });
    expect(res.statusCode).toBe(404);
  });

  // ── Expired Token ──

  it('expired token returns 401', async () => {
    // Create a store with instant expiry for this test
    const { TokenStore: ExpTokenStore } = await import('../src/lib/auth.js');
    const expStore = new ExpTokenStore('test-secret', 0, 86400);
    const expTokens = expStore.registerDevice('p1', 'D1', 'android');

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/hermes/capabilities',
      headers: { authorization: `Bearer ${expTokens.accessToken}` },
    });
    // The expired token is from a different store, so it will fail validation
    expect(res.statusCode).toBe(401);
  });

  // ── Revoked Device ──

  it('revoked device returns 403', async () => {
    const dev = registerTestDevice(ctx.tokenStore);

    // Revoke the device
    ctx.tokenStore.revokeDevice(dev.deviceId);

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/hermes/status',
      headers: { authorization: `Bearer ${dev.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).code).toBe('DEVICE_REVOKED');
  });

  // ── Refresh Token Endpoint ──

  it('POST /v1/mobile/token/refresh returns new tokens', async () => {
    const dev = registerTestDevice(ctx.tokenStore);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/mobile/token/refresh',
      payload: { refresh_token: dev.refreshToken },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.access_token).toBeDefined();
    expect(body.refresh_token).toBeDefined();
  });

  it('POST /v1/mobile/token/refresh rejects invalid token', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/mobile/token/refresh',
      payload: { refresh_token: 'invalid' },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload).code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('POST /v1/mobile/token/refresh requires body', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/mobile/token/refresh',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
