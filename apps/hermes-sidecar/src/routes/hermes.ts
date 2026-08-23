// ── Hermes status/info routes ──

import type { FastifyInstance } from 'fastify';
import type { HermesClient } from '../lib/hermes-client.js';
import type { AppConfig } from '../lib/config.js';

export function registerHermesRoutes(
  app: FastifyInstance,
  config: AppConfig,
  hermesClient: HermesClient
): void {
  // GET /v1/hermes/status — Hermes Gateway health
  app.get('/v1/hermes/status', async () => {
    const health = await hermesClient.getHealth();
    return health;
  });

  // GET /v1/hermes/capabilities
  app.get('/v1/hermes/capabilities', async () => {
    return hermesClient.getCapabilities();
  });

  // GET /v1/hermes/models
  app.get('/v1/hermes/models', async () => {
    return hermesClient.getModels();
  });

  // GET /v1/hermes/skills
  app.get('/v1/hermes/skills', async () => {
    return hermesClient.getSkills();
  });

  // GET /v1/hermes/toolsets
  app.get('/v1/hermes/toolsets', async () => {
    return hermesClient.getToolsets();
  });
}
