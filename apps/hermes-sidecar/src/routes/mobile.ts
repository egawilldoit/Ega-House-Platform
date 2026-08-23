// ── Mobile-specific routes (device management, alerts) ──

import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../lib/config.js';
import type { DeviceRegistrationRequest } from '../types/hermes.js';
import { TokenStore, type DeviceInfo } from '../lib/auth.js';
import { RateLimiter, RATE_LIMIT_PRESETS } from '../lib/rate-limiter.js';

export function registerMobileRoutes(
  app: FastifyInstance,
  config: AppConfig,
  tokenStore: TokenStore,
  rateLimiter: RateLimiter
): void {
  // GET /v1/mobile/alerts — list alerts for the authenticated device
  app.get('/v1/mobile/alerts', async (request, reply) => {
    const auth = request.authContext;
    if (!auth.authenticated) {
      reply.status(401).send({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
      return;
    }
    // Return empty alerts list in mock mode
    return { alerts: [], device_id: auth.deviceId };
  });

  // POST /v1/mobile/devices/register — register a new device
  app.post<{ Body: DeviceRegistrationRequest }>('/v1/mobile/devices/register', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_code', 'device_name', 'platform'],
        properties: {
          enrollment_code: { type: 'string' },
          device_name: { type: 'string' },
          platform: { type: 'string', enum: ['android', 'ios'] },
          push_token: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    // Rate limit device registration per IP
    const ipCheck = rateLimiter.checkWindow(
      'device_registration', req.ip,
      RATE_LIMIT_PRESETS.deviceRegistration.maxRequests
    );
    if (!ipCheck.allowed) {
      reply.status(429).send({
        error: 'Too many registration attempts',
        code: 'RATE_LIMITED',
        retryAfterMs: ipCheck.retryAfterMs,
      });
      return;
    }

    const body = req.body;

    // In mock mode, accept any enrollment code
    if (config.hermesIntegrationMode === 'mock') {
      // Create a mock principal and device
      const principalId = `principal_mock_${Date.now()}`;
      const tokens = tokenStore.registerDevice(
        principalId,
        body.device_name,
        body.platform,
        body.push_token
      );

      return {
        device_id: tokens.device_id,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: tokens.expiresIn,
        token_type: 'Bearer',
      };
    }

    // Real validation would happen here (Cloudflare Access JWT → enrollment code)
    throw new Error('Device registration not available in live mode without full auth setup');
  });
}
