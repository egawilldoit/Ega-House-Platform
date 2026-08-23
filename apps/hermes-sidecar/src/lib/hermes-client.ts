// ── Hermes Gateway Client ──
// Typed, isolated internal client. Never exposes the Hermes API key.
// Never forwards arbitrary headers from incoming requests.
// All calls go to 127.0.0.1:8642 (or mock server in test mode).

import type {
  HermesHealth,
  HermesCapability,
  HermesModel,
  HermesSkill,
  HermesToolset,
  HermesSession,
  HermesSessionMessage,
  HermesJob,
  HermesRunEvent,
} from '../types/hermes.js';
import type { AppConfig } from './config.js';

export class HermesClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(config: AppConfig) {
    // In mock mode, point to the mock Hermes server
    this.baseUrl = config.hermesIntegrationMode === 'mock'
      ? `http://${config.mockHermesHost}:${config.mockHermesPort}`
      : config.hermesGatewayUrl;
    this.apiKey = config.hermesApiKey;
    this.timeoutMs = 10_000;
  }

  private async request<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add Bearer auth for non-health endpoints
      if (!path.startsWith('/health')) {
        if (this.apiKey) {
          headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
      }

      const response = await fetch(url, {
        method: options?.method || 'GET',
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok && response.status !== 401 && response.status !== 404) {
        const errorBody = await response.text().catch(() => 'Unknown error');
        throw new Error(`Hermes upstream error: ${response.status} — ${errorBody.slice(0, 200)}`);
      }

      const text = await response.text();
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Read endpoints ──

  async getHealth(): Promise<HermesHealth> {
    return this.request<HermesHealth>('/health');
  }

  async getCapabilities(): Promise<{ capabilities: HermesCapability[] }> {
    return this.request<{ capabilities: HermesCapability[] }>('/v1/capabilities');
  }

  async getModels(): Promise<{ models: HermesModel[] }> {
    return this.request<{ models: HermesModel[] }>('/v1/models');
  }

  async getSkills(): Promise<{ skills: HermesSkill[] }> {
    return this.request<{ skills: HermesSkill[] }>('/v1/skills');
  }

  async getToolsets(): Promise<{ toolsets: HermesToolset[] }> {
    return this.request<{ toolsets: HermesToolset[] }>('/v1/toolsets');
  }

  async getSessions(): Promise<HermesSession[]> {
    return this.request<HermesSession[]>('/api/sessions');
  }

  async getSession(sessionId: string): Promise<HermesSession> {
    return this.request<HermesSession>(`/api/sessions/${sessionId}`);
  }

  async getSessionMessages(sessionId: string): Promise<HermesSessionMessage[]> {
    return this.request<HermesSessionMessage[]>(`/api/sessions/${sessionId}/messages`);
  }

  async getJobs(): Promise<HermesJob[]> {
    return this.request<HermesJob[]>('/api/jobs');
  }

  async getJob(jobId: string): Promise<HermesJob> {
    return this.request<HermesJob>(`/api/jobs/${jobId}`);
  }

  // SSE event stream (returns a readable stream that the sidecar wraps)
  async getRunEventsStream(runId: string): Promise<Response> {
    const url = `${this.baseUrl}/v1/runs/${runId}/events`;
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return fetch(url, { headers, signal: AbortSignal.timeout(this.timeoutMs * 6) });
  }

  // Test helper
  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }
}
