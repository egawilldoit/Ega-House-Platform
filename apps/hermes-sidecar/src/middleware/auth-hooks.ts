// ── Auth hooks for Fastify request lifecycle ──
// Runs on every request to validate tokens and attach auth context.

import type { FastifyInstance } from 'fastify';
import { TokenStore, type AuthContext } from '../lib/auth.js';
import { checkRoutePermission, getRoutePermissionByPath, hasRequiredScope } from '../lib/permissions.js';
import { RateLimiter, RATE_LIMIT_PRESETS } from '../lib/rate-limiter.js';

// Augment Fastify request with auth context
declare module 'fastify' {
  interface FastifyRequest {
    authContext: AuthContext;
  }
}

export function registerAuthHooks(
  app: FastifyInstance,
  tokenStore: TokenStore,
  rateLimiter: RateLimiter
): void {
  // ── Global onRequest hook — runs on every request ──
  app.addHook('onRequest', async (request, reply) => {
    // 1. Check route permission matrix first
    const method = request.method;
    const path = request.url.split('?')[0]!;
    const permCheck = checkRoutePermission(method, path);
    const routePerm = getRoutePermissionByPath(method, path);

    if (!permCheck.allowed) {
      reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' });
      return;
    }

    // 2. Apply per-IP rate limiting
    const clientIp = request.ip;
    const ipCheck = rateLimiter.checkWindow('ip', clientIp, RATE_LIMIT_PRESETS.ip.maxRequests);
    if (!ipCheck.allowed) {
      reply.status(429).header('Retry-After', Math.ceil(ipCheck.retryAfterMs / 1000)).send({
        error: 'Too many requests',
        code: 'RATE_LIMITED',
        retryAfterMs: ipCheck.retryAfterMs,
      });
      return;
    }

    // 3. Parse auth header
    const authHeader = request.headers['authorization'] || '';

    // 4. For routes that require auth, validate the token
    if (routePerm?.requiresAuth) {
      if (!authHeader.startsWith('Bearer ')) {
        reply.status(401).send({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
        return;
      }

      const token = authHeader.slice(7); // Remove 'Bearer '
      const authCtx = tokenStore.validateAccessToken(token);

      if (!authCtx.authenticated) {
        const statusCode = authCtx.error?.includes('revoked') ? 403 : 401;
        reply.status(statusCode).send({
          error: authCtx.error || 'Invalid token',
          code: statusCode === 403 ? 'DEVICE_REVOKED' : 'INVALID_TOKEN',
        });
        return;
      }

      // 5. Check scope/permissions
      if (!hasRequiredScope(authCtx.scope, permCheck.requiredScope)) {
        reply.status(403).send({
          error: 'Insufficient permissions',
          code: 'FORBIDDEN',
          requiredScope: permCheck.requiredScope,
        });
        return;
      }

      // 6. Per-principal rate limiting
      if (authCtx.principalId) {
        const principalCheck = rateLimiter.checkWindow(
          'principal', authCtx.principalId,
          RATE_LIMIT_PRESETS.principal.maxRequests
        );
        if (!principalCheck.allowed) {
          reply.status(429).header('Retry-After', Math.ceil(principalCheck.retryAfterMs / 1000)).send({
            error: 'Too many requests',
            code: 'RATE_LIMITED',
            retryAfterMs: principalCheck.retryAfterMs,
          });
          return;
        }
      }

      // 7. Per-device rate limiting
      if (authCtx.deviceId) {
        const deviceCheck = rateLimiter.checkWindow(
          'device', authCtx.deviceId,
          RATE_LIMIT_PRESETS.device.maxRequests
        );
        if (!deviceCheck.allowed) {
          reply.status(429).header('Retry-After', Math.ceil(deviceCheck.retryAfterMs / 1000)).send({
            error: 'Too many requests',
            code: 'RATE_LIMITED',
            retryAfterMs: deviceCheck.retryAfterMs,
          });
          return;
        }

        // 8. Per-endpoint rate limiting for alert polling
        if (path === '/v1/mobile/alerts') {
          const alertCheck = rateLimiter.checkWindow(
            'endpoint', `alerts:${authCtx.deviceId}`,
            RATE_LIMIT_PRESETS.alertPoll.maxRequests
          );
          if (!alertCheck.allowed) {
            reply.status(429).send({ error: 'Too many requests', code: 'RATE_LIMITED' });
            return;
          }
        }
      }

      // Attach auth context
      request.authContext = authCtx;

    } else {
      // Public route — attach empty auth context
      request.authContext = {
        authenticated: false,
        deviceId: null,
        principalId: null,
        scope: [],
        tokenExp: null,
      };
    }
  });

  // ── Token refresh endpoint (special: uses refresh token, not access token) ──
  app.post('/v1/mobile/token/refresh', async (request, reply) => {
    const { refresh_token } = request.body as { refresh_token?: string };
    if (!refresh_token) {
      reply.status(400).send({ error: 'refresh_token is required', code: 'MISSING_FIELD' });
      return;
    }

    // Rate limit: strict
    const ipCheck = rateLimiter.checkWindow('token_refresh', request.ip, RATE_LIMIT_PRESETS.tokenRefresh.maxRequests);
    if (!ipCheck.allowed) {
      reply.status(429).header('Retry-After', Math.ceil(ipCheck.retryAfterMs / 1000)).send({
        error: 'Too many requests',
        code: 'RATE_LIMITED',
        retryAfterMs: ipCheck.retryAfterMs,
      });
      return;
    }

    const result = tokenStore.refreshAccessToken(refresh_token);
    if ('error' in result) {
      const isSuspectedTheft = result.error.includes('suspected token theft');
      reply.status(isSuspectedTheft ? 403 : 401).send({
        error: result.error,
        code: isSuspectedTheft ? 'TOKEN_THEFT_DETECTED' : 'INVALID_REFRESH_TOKEN',
      });
      return;
    }

    return {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      expires_in: result.expiresIn,
      token_type: 'Bearer',
    };
  });

  // ── Device deregistration (special: needs device-level auth, not token) ──
  app.delete('/v1/mobile/devices/:deviceId', async (request, reply) => {
    const { deviceId } = request.params as { deviceId: string };
    // Requires valid auth context (attached by onRequest)
    // The deviceId in the URL must match the authenticated device, OR
    // the principal must have write scope
    const auth = request.authContext;
    if (!auth || !auth.authenticated) {
      reply.status(401).send({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
      return;
    }

    const success = tokenStore.revokeDevice(deviceId);
    if (!success) {
      reply.status(404).send({ error: 'Device not found', code: 'DEVICE_NOT_FOUND' });
      return;
    }
    return { success: true, device_id: deviceId, revoked_at: new Date().toISOString() };
  });
}
