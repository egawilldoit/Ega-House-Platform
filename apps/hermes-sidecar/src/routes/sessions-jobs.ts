// ── Session and Job routes ──

import type { FastifyInstance } from 'fastify';
import type { HermesClient } from '../lib/hermes-client.js';

export function registerSessionRoutes(
  app: FastifyInstance,
  hermesClient: HermesClient
): void {
  // GET /v1/sessions — list all sessions
  app.get('/v1/sessions', async () => {
    return hermesClient.getSessions();
  });

  // GET /v1/sessions/:sessionId — single session
  app.get<{ Params: { sessionId: string } }>('/v1/sessions/:sessionId', async (req, reply) => {
    try {
      return await hermesClient.getSession(req.params.sessionId);
    } catch {
      reply.status(404);
      return { error: 'Session not found', code: 'NOT_FOUND' };
    }
  });

  // GET /v1/sessions/:sessionId/messages — session messages
  app.get<{ Params: { sessionId: string } }>('/v1/sessions/:sessionId/messages', async (req) => {
    return hermesClient.getSessionMessages(req.params.sessionId);
  });
}

export function registerJobRoutes(
  app: FastifyInstance,
  hermesClient: HermesClient
): void {
  // GET /v1/jobs — list all jobs
  app.get('/v1/jobs', async () => {
    return hermesClient.getJobs();
  });

  // GET /v1/jobs/:jobId — single job
  app.get<{ Params: { jobId: string } }>('/v1/jobs/:jobId', async (req) => {
    return hermesClient.getJob(req.params.jobId);
  });
}
