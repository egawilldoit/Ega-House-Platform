// ── Mock Hermes Gateway for isolated test/development ──
// Binds to MOCK_HERMES_HOST:MOCK_HERMES_PORT
// Serves pre-recorded fixtures for all endpoints the sidecar consumes.

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from './config.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '..', 'fixtures');

// Default JSON fixtures
const DEFAULT_FIXTURES: Record<string, Record<string, unknown>> = {
  '/health': {
    status: 'ok',
    platform: 'hermes-agent',
    version: '0.19.0',
  },
  '/health/detailed': {
    status: 'ok',
    version: '0.19.0',
    uptime: 86400,
    active_runs: 0,
    pending_approvals: 0,
    connected_platforms: ['slack', 'api_server'],
  },
  '/v1/capabilities': {
    capabilities: [
      { id: 'chat', name: 'Chat Completions', description: 'Standard chat API', enabled: true },
      { id: 'runs', name: 'Run Management', description: 'Create and manage runs', enabled: true },
      { id: 'sessions', name: 'Session Management', description: 'Session CRUD', enabled: true },
      { id: 'jobs', name: 'Cron Jobs', description: 'Scheduled job management', enabled: true },
    ],
  },
  '/v1/models': {
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'opencode-go' },
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic' },
      { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
    ],
  },
  '/v1/skills': {
    skills: [
      { name: 'code-review', description: 'Review pull requests', category: 'development' },
      { name: 'planning', description: 'Create implementation plans', category: 'productivity' },
    ],
  },
  '/v1/toolsets': {
    toolsets: [
      { name: 'terminal', description: 'Shell command execution', tools: ['terminal'] },
      { name: 'file', description: 'File operations', tools: ['read_file', 'write_file'] },
    ],
  },
};

const DEFAULT_COLLECTIONS: Record<string, Record<string, unknown>[]> = {
  '/api/sessions': [
    { id: 'sess_001', title: 'Daily planning', created_at: '2026-07-26T06:00:00Z', updated_at: '2026-07-26T12:00:00Z', message_count: 24 },
    { id: 'sess_002', title: 'Bug investigation', created_at: '2026-07-25T14:00:00Z', updated_at: '2026-07-26T08:00:00Z', message_count: 56 },
    { id: 'sess_003', title: 'Code review session', created_at: '2026-07-24T10:00:00Z', updated_at: '2026-07-25T18:00:00Z', message_count: 12 },
  ],
  '/api/jobs': [
    { id: 'job_001', name: 'Daily maintenance', schedule: '0 6 * * *', status: 'active', last_run: '2026-07-26T06:00:00Z', next_run: '2026-07-27T06:00:00Z' },
    { id: 'job_002', name: 'Weekly report', schedule: '0 9 * * 1', status: 'active', last_run: '2026-07-21T09:00:00Z', next_run: '2026-07-28T09:00:00Z' },
  ],
};

const SESSION_MESSAGES: Record<string, Record<string, unknown>[]> = {
  'sess_001': [
    { id: 'msg_001', role: 'user', content: 'What\'s on my calendar today?', created_at: '2026-07-26T06:01:00Z' },
    { id: 'msg_002', role: 'assistant', content: 'Here\'s your plan for today...', created_at: '2026-07-26T06:01:05Z' },
  ],
  'sess_002': [
    { id: 'msg_003', role: 'user', content: 'The API is returning 500 errors', created_at: '2026-07-25T14:05:00Z' },
    { id: 'msg_004', role: 'assistant', content: 'Let me check the logs...', created_at: '2026-07-25T14:05:10Z' },
  ],
};

export class MockHermesServer {
  private server: Server | null = null;
  private port: number;
  private host: string;

  constructor(config: AppConfig) {
    this.port = config.mockHermesPort;
    this.host = config.mockHermesHost;
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
        this.handleRequest(req, res);
      });
      this.server.listen(this.port, this.host, () => {
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  getAddress(): string {
    return `http://${this.host}:${this.port}`;
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || '/';
    const method = req.method || 'GET';
    const authHeader: string = req.headers['authorization'] || '';

    // Handle parameterized paths
    const sessionMatch = url.match(/^\/api\/sessions\/([^/]+)$/);
    const messagesMatch = url.match(/^\/api\/sessions\/([^/]+)\/messages$/);
    const jobMatch = url.match(/^\/api\/jobs\/([^/]+)$/);

    // Auth check — return 401 for non-health endpoints without bearer token
    const isHealthEndpoint = url === '/health' || url === '/v1/health';

    if (!isHealthEndpoint && !authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid gateway API key (API_SERVER_KEY)', type: 'gateway_auth_error' } }));
      return;
    }

    let statusCode = 200;
    let body: unknown = null;

    if (DEFAULT_FIXTURES[url]) {
      body = DEFAULT_FIXTURES[url];
    } else if (DEFAULT_COLLECTIONS[url]) {
      body = DEFAULT_COLLECTIONS[url];
    } else if (sessionMatch && sessionMatch[1]) {
      const sessionId = sessionMatch[1];
      const session = DEFAULT_COLLECTIONS['/api/sessions']?.find((s: Record<string, unknown>) => s.id === sessionId);
      if (session) {
        body = session;
      } else {
        statusCode = 404;
        body = { error: 'Session not found' };
      }
    } else if (messagesMatch && messagesMatch[1]) {
      const sessionId = messagesMatch[1];
      const messages = SESSION_MESSAGES[sessionId];
      if (messages) {
        body = messages;
      } else {
        body = [];
      }
    } else if (jobMatch && jobMatch[1]) {
      const jobId = jobMatch[1];
      const job = DEFAULT_COLLECTIONS['/api/jobs']?.find((j: Record<string, unknown>) => j.id === jobId);
      if (job) {
        body = job;
      } else {
        statusCode = 404;
        body = { error: 'Job not found' };
      }
    } else if (url.startsWith('/v1/runs/') && url.endsWith('/events')) {
      // SSE event stream
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('event: ping\ndata: {"timestamp":"2026-07-26T12:00:00Z"}\n\n');
      res.write('event: run_update\ndata: {"run_id":"run_001","status":"running","progress":0.5}\n\n');
      res.end('event: done\ndata: {}\n\n');
      return;
    } else {
      statusCode = 404;
      body = { error: 'Not found', path: url };
    }

    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(body));
  }
}
