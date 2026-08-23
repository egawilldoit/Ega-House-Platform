// ── Fastify App ──
// Assembles all routes, middleware, and security boundaries.

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './lib/config.js';
import { createLoggerConfig } from './lib/logger.js';
import { HermesClient } from './lib/hermes-client.js';
import { TokenStore } from './lib/auth.js';
import { RateLimiter } from './lib/rate-limiter.js';
import { EventBus, registerWebSocketRelay } from './lib/event-relay.js';
import { isPathForbidden } from './lib/security-boundary.js';
import { registerAuthHooks } from './middleware/auth-hooks.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerHermesRoutes } from './routes/hermes.js';
import { registerSessionRoutes, registerJobRoutes } from './routes/sessions-jobs.js';
import { registerMobileRoutes } from './routes/mobile.js';

export interface AppDependencies {
  config: AppConfig;
  hermesClient: HermesClient;
  tokenStore?: TokenStore;
  rateLimiter?: RateLimiter;
  eventBus?: EventBus;
}

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const { config, hermesClient } = deps;

  // ── Shared services ──
  const tokenStore = deps.tokenStore || new TokenStore();
  const rateLimiter = deps.rateLimiter || new RateLimiter();
  const eventBus = deps.eventBus || new EventBus();

  const app = Fastify({
    logger: createLoggerConfig(config),
    bodyLimit: 10 * 1024, // 10KB default body limit
    requestTimeout: 30_000, // 30s default request timeout
  });

  // ── Security boundary hooks ──

  // Block forbidden path patterns at the router level
  app.addHook('onRoute', (routeOptions) => {
    const path = routeOptions.url;
    const check = isPathForbidden(path);
    if (check.forbidden) {
      throw new Error(
        `Cannot register forbidden route: ${path} — ${check.reason}`
      );
    }
  });

  // ── Catch-all for unknown routes (must return 404, not 401) ──
  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' });
  });

  // ── Error handler — redact upstream errors ──
  app.setErrorHandler((error, request, reply) => {
    const err = error as Error & { statusCode?: number };
    request.log.error({ err, path: request.url }, 'Unhandled error');

    const statusCode = (error as Record<string, number>).statusCode || 500;
    reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Upstream unavailable' : err.message,
      code: statusCode >= 500 ? 'UPSTREAM_ERROR' : 'REQUEST_ERROR',
    });
  });

  // ── Auth middleware (onRequest hook) ──
  registerAuthHooks(app, tokenStore, rateLimiter);

  // ── Register routes ──

  // Public routes (no auth)
  registerHealthRoutes(app, config, hermesClient);

  // Protected routes — auth enforced by middleware
  registerHermesRoutes(app, config, hermesClient);
  registerSessionRoutes(app, hermesClient);
  registerJobRoutes(app, hermesClient);
  registerMobileRoutes(app, config, tokenStore, rateLimiter);

  // ── Write routes — disabled by default ──
  if (config.mobileWriteActionsEnabled) {
    registerWriteRoutes(app, config, hermesClient);
  }

  // ── WebSocket event relay ──
  await registerWebSocketRelay(app, eventBus);

  // ── OpenAPI docs (dev only) ──
  if (config.hermesIntegrationMode === 'mock') {
    await registerOpenApi(app);
  }

  // ── Start mock events in dev mode ──
  if (config.hermesIntegrationMode === 'mock') {
    const stopMock = eventBus.startMockEvents();

    // Clean up on close
    app.addHook('onClose', (_app, done) => {
      stopMock();
      eventBus.destroy();
      done();
    });
  }

  return app;
}

async function registerOpenApi(app: FastifyInstance): Promise<void> {
  const swagger = await import('@fastify/swagger');
  const swaggerUi = await import('@fastify/swagger-ui');

  await app.register(swagger.default, {
    openapi: {
      info: {
        title: 'Hermes Mobile Sidecar API',
        description: 'Secure gateway between Hermes Agent and mobile Android devices',
        version: '0.2.0',
      },
      servers: [{ url: 'http://127.0.0.1:18790', description: 'Development' }],
    },
  });

  await app.register(swaggerUi.default, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });
}

// Write routes — only registered when MOBILE_WRITE_ACTIONS_ENABLED=true
function registerWriteRoutes(
  app: FastifyInstance,
  config: AppConfig,
  hermesClient: HermesClient
): void {
  app.log.warn('Write actions are ENABLED — this should only be used in controlled test environments');

  // Scaffolded but not fully implemented
  app.post('/v1/hermes/chat', async () => {
    throw new Error('Write actions not yet implemented');
  });
}
