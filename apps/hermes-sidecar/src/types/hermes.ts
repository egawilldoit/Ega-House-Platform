// ── Hermes Gateway API response types ──

export interface HermesHealth {
  status: 'ok' | 'error';
  platform: string;
  version: string;
}

export interface HermesCapability {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface HermesModel {
  id: string;
  name: string;
  provider: string;
  description?: string;
}

export interface HermesSkill {
  name: string;
  description: string;
  category?: string;
}

export interface HermesToolset {
  name: string;
  description: string;
  tools: string[];
}

export interface HermesSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export interface HermesSessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface HermesJob {
  id: string;
  name: string;
  schedule: string;
  status: 'active' | 'paused' | 'completed' | 'failed';
  last_run?: string;
  next_run?: string;
}

export interface HermesRunEvent {
  type: string;
  run_id: string;
  data: Record<string, unknown>;
  timestamp: string;
}

// ── Sidecar-specific types ──

export interface SidecarHealth {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number;
  timestamp: string;
  mode: 'mock' | 'live';
}

export interface SidecarReadiness {
  status: 'ready' | 'not_ready';
  checks: {
    database: boolean;
    hermes_reachable: boolean;
    config_valid: boolean;
  };
}

export interface MobileDevice {
  id: string;
  principal_id: string;
  device_name: string;
  platform: 'android' | 'ios';
  push_token?: string;
  created_at: string;
  last_seen_at: string;
  is_revoked: boolean;
}

export interface MobileAlert {
  id: string;
  device_id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  read: boolean;
  created_at: string;
}

export interface DeviceRegistrationRequest {
  enrollment_code: string;
  device_name: string;
  platform: 'android' | 'ios';
  push_token?: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'Bearer';
}

export interface CfAccessJwtPayload {
  aud: string[];
  email: string;
  exp: number;
  iat: number;
  iss: string;
  sub: string;
}
