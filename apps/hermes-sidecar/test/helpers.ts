// ── Shared test helpers ──

import { TokenStore } from '../src/lib/auth.js';
import { RateLimiter } from '../src/lib/rate-limiter.js';
import { EventBus } from '../src/lib/event-relay.js';
import { MockHermesServer } from '../src/lib/mock-hermes.js';
import { HermesClient } from '../src/lib/hermes-client.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/lib/config.js';
import type { FastifyInstance } from 'fastify';

export interface TestContext {
  app: FastifyInstance;
  tokenStore: TokenStore;
  rateLimiter: RateLimiter;
  eventBus: EventBus;
  mockServer: MockHermesServer;
  config: ReturnType<typeof loadConfig>;
  hermesClient: HermesClient;
}

/**
 * Build a fully wired test app with shared services.
 */
export async function createTestContext(): Promise<TestContext> {
  const config = loadConfig();
  const tokenStore = new TokenStore();
  const rateLimiter = new RateLimiter();
  const eventBus = new EventBus();
  const mockServer = new MockHermesServer(config);
  const hermesClient = new HermesClient(config);

  await mockServer.start();

  const app = await buildApp({
    config,
    hermesClient,
    tokenStore,
    rateLimiter,
    eventBus,
  });

  await app.ready();

  return { app, tokenStore, rateLimiter, eventBus, mockServer, config, hermesClient };
}

/**
 * Register a test device and return a valid access token.
 */
export function registerTestDevice(tokenStore: TokenStore): {
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  principalId: string;
} {
  const tokens = tokenStore.registerDevice(
    'test_principal',
    'Test Device',
    'android'
  );
  // Extract device ID from the access token
  const payload = JSON.parse(
    Buffer.from(tokens.accessToken.split('.')[1]!, 'base64url').toString()
  );

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    deviceId: payload.sub,
    principalId: 'test_principal',
  };
}

/**
 * Clean up test context.
 */
export async function destroyTestContext(ctx: TestContext): Promise<void> {
  ctx.eventBus.destroy();
  await ctx.app.close();
  await ctx.mockServer.stop();
}
