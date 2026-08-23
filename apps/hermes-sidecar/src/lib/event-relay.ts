// ── WebSocket Event Relay ──
// Consumes Hermes SSE events and relays them to authenticated WebSocket clients.

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { AuthContext } from './auth.js';
import { randomBytes } from 'node:crypto';

// ── Event Types ──

export interface RelayEvent {
  id: string;
  sequence: number;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

// ── Client Connection State ──

interface ClientConnection {
  id: string;
  ws: WebSocket;
  deviceId: string;
  principalId: string;
  lastEventId: string | null;
  lastSequence: number;
  queue: RelayEvent[];
  maxQueueSize: number;
  createdAt: number;
  lastActivityAt: number;
  slowThresholdMs: number;
  closed: boolean;
}

// ── Event Bus ──

export class EventBus {
  private sequence = 0;
  private clients = new Map<string, ClientConnection>();
  private eventLog: RelayEvent[] = [];
  private maxEventLog = 1000;
  private heartbeatIntervalMs = 30_000;
  private cleanupIntervalMs = 10_000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private slowClientThresholdMs = 30_000;
  private maxReconnectCatchup = 100;

  constructor() {
    this.startBackgroundTimers();
  }

  publish(type: string, data: Record<string, unknown>): RelayEvent {
    this.sequence++;
    const event: RelayEvent = {
      id: `evt_${this.sequence}_${randomBytes(4).toString('hex')}`,
      sequence: this.sequence,
      type,
      data,
      timestamp: new Date().toISOString(),
    };

    this.eventLog.push(event);
    if (this.eventLog.length > this.maxEventLog) {
      this.eventLog.shift();
    }

    for (const [, client] of this.clients) {
      if (client.closed) continue;
      this.enqueueForClient(client, event);
    }

    return event;
  }

  registerClient(
    ws: WebSocket,
    auth: AuthContext,
    lastEventId?: string | null
  ): string {
    const deviceId = auth.deviceId || 'unknown';
    const clientId = `ws_${deviceId}_${Date.now()}`;

    const client: ClientConnection = {
      id: clientId,
      ws,
      deviceId,
      principalId: auth.principalId || 'unknown',
      lastEventId: lastEventId || null,
      lastSequence: 0,
      queue: [],
      maxQueueSize: 100,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      slowThresholdMs: this.slowClientThresholdMs,
      closed: false,
    };

    if (lastEventId) {
      const catchupEvents = this.getEventsSince(lastEventId);
      for (const event of catchupEvents.slice(0, this.maxReconnectCatchup)) {
        this.enqueueForClient(client, event);
      }
    }

    this.clients.set(clientId, client);
    this.startClientDrain(client);
    this.startClientHeartbeat(client);

    return clientId;
  }

  unregisterClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.closed = true;
      this.clients.delete(clientId);
    }
  }

  getConnectedCount(): number {
    return this.clients.size;
  }

  private enqueueForClient(client: ClientConnection, event: RelayEvent): void {
    if (client.queue.length >= client.maxQueueSize) {
      client.queue.shift();
    }
    client.queue.push(event);
  }

  private startClientDrain(client: ClientConnection): void {
    const drain = () => {
      if (client.closed) return;

      const now = Date.now();
      if (now - client.lastActivityAt > client.slowThresholdMs) {
        try {
          client.ws.close(4001, 'Client too slow — disconnected');
        } catch { /* ignore */ }
        return;
      }

      while (client.queue.length > 0 && !client.closed) {
        const event = client.queue[0]!;
        try {
          const message = JSON.stringify({
            id: event.id,
            sequence: event.sequence,
            type: event.type,
            data: event.data,
            timestamp: event.timestamp,
          });
          client.ws.send(message);
          client.queue.shift();
          client.lastEventId = event.id;
          client.lastSequence = event.sequence;
        } catch {
          client.closed = true;
          this.clients.delete(client.id);
          return;
        }
      }

      if (client.queue.length > 0) {
        setImmediate(drain);
      } else {
        setTimeout(drain, 100);
      }
    };

    setImmediate(drain);
  }

  private startClientHeartbeat(client: ClientConnection): void {
    const heartbeat = () => {
      if (client.closed) return;
      try {
        client.ws.send(JSON.stringify({
          type: 'heartbeat',
          timestamp: new Date().toISOString(),
        }));
      } catch {
        client.closed = true;
        this.clients.delete(client.id);
      }
    };

    const interval = setInterval(heartbeat, this.heartbeatIntervalMs);

    // Clean up interval on close by wrapping
    const origClose = client.ws.close.bind(client.ws);
    client.ws.close = ((code?: number, reason?: string) => {
      clearInterval(interval);
      return origClose(code, reason);
    }) as typeof client.ws.close;

    // Also clean up on error
    client.ws.onerror = () => {
      clearInterval(interval);
    };
  }

  private getEventsSince(lastEventId: string): RelayEvent[] {
    const index = this.eventLog.findIndex((e) => e.id === lastEventId);
    if (index === -1) return [];
    return this.eventLog.slice(index + 1);
  }

  private startBackgroundTimers(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [, client] of this.clients) {
        if (client.closed) continue;
        client.lastActivityAt = Date.now();
      }
    }, this.heartbeatIntervalMs);

    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [clientId, client] of this.clients) {
        if (client.closed) {
          this.clients.delete(clientId);
          continue;
        }
        if (now - client.lastActivityAt > client.slowThresholdMs * 2) {
          try {
            client.ws.close(4001, 'Client timed out');
          } catch { /* ignore */ }
          this.clients.delete(clientId);
        }
      }
    }, this.cleanupIntervalMs);
  }

  destroy(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    for (const [, client] of this.clients) {
      try { client.ws.close(4001, 'Server shutting down'); } catch { /* ignore */ }
    }
    this.clients.clear();
    this.eventLog = [];
  }

  /**
   * Start publishing mock events for development/testing.
   */
  startMockEvents(): () => void {
    let counter = 0;
    const interval = setInterval(() => {
      counter++;
      this.publish('run_update', {
        run_id: `run_${counter}`,
        status: counter % 3 === 0 ? 'completed' : 'running',
        progress: Math.min(1, counter * 0.1),
      });

      if (counter % 5 === 0) {
        this.publish('health_change', {
          status: 'ok',
          uptime: 86400 + counter,
        });
      }

      if (counter === 1) {
        this.publish('alert', {
          type: 'info',
          title: 'System ready',
          body: 'Mobile sidecar is operational',
        });
      }
    }, 5000);

    return () => clearInterval(interval);
  }
}

// ── Fastify WebSocket plugin registration ──

import fastifyWebsocket from '@fastify/websocket';

export async function registerWebSocketRelay(
  app: FastifyInstance,
  eventBus: EventBus
): Promise<void> {
  await app.register(fastifyWebsocket);

  app.get('/v1/mobile/events', { websocket: true }, (socket, req) => {
    // Auth is already done by the onRequest hook and attached to req
    const reqAny = req as unknown as Record<string, unknown>;
    const auth = reqAny['authContext'] as AuthContext | undefined;

    // WebSocket upgrade happens after onRequest, so we validate here too
    if (!auth || !auth.authenticated) {
      socket.close(4001, 'Authentication required');
      return;
    }

    const urlObj = new URL(req.url, 'http://localhost');
    const lastEventId = urlObj.searchParams.get('lastEventId');
    const clientId = eventBus.registerClient(socket as unknown as WebSocket, auth, lastEventId);

    socket.on('close', () => {
      eventBus.unregisterClient(clientId);
    });

    socket.on('error', () => {
      eventBus.unregisterClient(clientId);
    });

    // Handle incoming messages (client acknowledgments, pongs)
    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'pong') {
          // Client responding to heartbeat — update activity
          // (the drain function tracks activity)
        }
      } catch { /* ignore malformed messages */ }
    });
  });
}
