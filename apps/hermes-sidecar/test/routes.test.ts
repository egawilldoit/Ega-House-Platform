// ── Route integration tests ──

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext, registerTestDevice, destroyTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
let accessToken: string;

beforeAll(async () => {
  ctx = await createTestContext();
  const dev = registerTestDevice(ctx.tokenStore);
  accessToken = dev.accessToken;
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

// ── Public Routes (no auth) ──

describe('GET /health (public)', () => {
  it('returns 200 with status ok (no auth)', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('ok');
  });

  it('returns 200 with auth header (also works)', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /ready (public)', () => {
  it('returns ready when Hermes is reachable', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('ready');
  });
});

// ── Protected Routes (require auth) ──

describe('Protected routes require auth', () => {
  const protectedEndpoints = [
    { method: 'GET', url: '/v1/hermes/capabilities' },
    { method: 'GET', url: '/v1/hermes/models' },
    { method: 'GET', url: '/v1/hermes/skills' },
    { method: 'GET', url: '/v1/hermes/toolsets' },
    { method: 'GET', url: '/v1/sessions' },
    { method: 'GET', url: '/v1/sessions/sess_001' },
    { method: 'GET', url: '/v1/sessions/sess_001/messages' },
    { method: 'GET', url: '/v1/jobs' },
    { method: 'GET', url: '/v1/jobs/job_001' },
    { method: 'GET', url: '/v1/mobile/alerts' },
  ];

  for (const ep of protectedEndpoints) {
    it(`${ep.method} ${ep.url} returns 401 without auth`, async () => {
      const res = await ctx.app.inject({ method: ep.method as 'GET', url: ep.url });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('AUTH_REQUIRED');
    });

    it(`${ep.method} ${ep.url} returns 200 with valid auth`, async () => {
      const res = await ctx.app.inject({
        method: ep.method as 'GET',
        url: ep.url,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
    });
  }
});

// ── Hermes Info Routes ──

describe('GET /v1/hermes/* (authenticated)', () => {
  it('GET /v1/hermes/status returns Hermes health', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/hermes/status',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).status).toBe('ok');
  });

  it('GET /v1/hermes/capabilities returns capabilities array', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/hermes/capabilities',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body.capabilities)).toBe(true);
    expect(body.capabilities.length).toBeGreaterThan(0);
  });

  it('GET /v1/hermes/models returns models', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/hermes/models',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.payload).models)).toBe(true);
  });
});

// ── Session Routes ──

describe('GET /v1/sessions (authenticated)', () => {
  it('returns sessions list', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.payload))).toBe(true);
  });

  it('returns error for unknown session', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/sessions/nonexistent',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty('error');
  });
});

// ── Mobile Routes ──

describe('POST /v1/mobile/devices/register (public)', () => {
  it('registers a device in mock mode', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/mobile/devices/register',
      payload: {
        enrollment_code: 'test123',
        device_name: 'Test Device',
        platform: 'android',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.access_token).toBeDefined();
    expect(body.refresh_token).toBeDefined();
    expect(body.token_type).toBe('Bearer');
  });

  it('rate limits registration attempts', async () => {
    // Burst registrations to hit the rate limit
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/v1/mobile/devices/register',
        payload: {
          enrollment_code: `test${i}`,
          device_name: `Device ${i}`,
          platform: 'android',
        },
      });
      results.push(res.statusCode);
    }
    // At least one should be rate limited
    expect(results.includes(429)).toBe(true);
  });

  it('rejects invalid platform', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/mobile/devices/register',
      payload: {
        enrollment_code: 'test123',
        device_name: 'Bad Device',
        platform: 'windows',
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /v1/mobile/devices/:deviceId (authenticated)', () => {
  it('deregisters own device', async () => {
    const dev = registerTestDevice(ctx.tokenStore);
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/mobile/devices/${dev.deviceId}`,
      headers: { authorization: `Bearer ${dev.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).success).toBe(true);
  });

  it('fails without auth', async () => {
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: '/v1/mobile/devices/some-device',
    });
    expect(res.statusCode).toBe(401);
  });
});
