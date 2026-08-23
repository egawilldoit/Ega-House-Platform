// ── Main entry — Safe Development Mode ──

import { loadConfig } from './lib/config.js';
import { HermesClient } from './lib/hermes-client.js';
import { TokenStore } from './lib/auth.js';
import { RateLimiter } from './lib/rate-limiter.js';
import { EventBus } from './lib/event-relay.js';
import { MockHermesServer } from './lib/mock-hermes.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // ── Shared services ──
  const tokenStore = new TokenStore();
  const rateLimiter = new RateLimiter();
  const eventBus = new EventBus();

  console.log(JSON.stringify({
    msg: 'Hermes Mobile Sidecar starting',
    mode: config.hermesIntegrationMode,
    port: config.port,
    host: config.host,
    writeEnabled: config.mobileWriteActionsEnabled,
    databaseMode: config.databaseMode,
  }));

  // Start mock Hermes server if in mock mode
  let mockServer: MockHermesServer | null = null;
  if (config.hermesIntegrationMode === 'mock') {
    mockServer = new MockHermesServer(config);
    await mockServer.start();
    console.log(`Mock Hermes server started on ${mockServer.getAddress()}`);
  }

  // Create Hermes client
  const hermesClient = new HermesClient(config);

  // Build and start the Fastify app
  const app = await buildApp({
    config,
    hermesClient,
    tokenStore,
    rateLimiter,
    eventBus,
  });

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`Sidecar listening on http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error({ err }, 'Failed to start sidecar');
    if (mockServer) await mockServer.stop();
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    eventBus.destroy();
    await app.close();
    if (mockServer) await mockServer.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal error starting sidecar:', err);
  process.exit(1);
});
