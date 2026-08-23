import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicitly load .env before anything else — override existing env vars
dotenvConfig({ override: true });

interface AppConfig {
  port: number;
  host: string;
  logLevel: string;
  hermesIntegrationMode: 'mock' | 'live';
  mobileWriteActionsEnabled: boolean;
  pushDeliveryEnabled: boolean;
  databaseMode: 'test' | 'production';
  mockHermesPort: number;
  mockHermesHost: string;
  hermesApiKey: string;
  hermesGatewayUrl: string;
  accessTokenExpiryMs: number;
  refreshTokenExpiryMs: number;
  allowedEmails: string[];
  databaseUrl: string;
  sidecarBindAddress: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

function envRequired(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

function envInt(name: string, defaultVal: number): number {
  const val = process.env[name];
  return val ? parseInt(val, 10) : defaultVal;
}

function envBool(name: string, defaultVal: boolean): boolean {
  const val = process.env[name];
  if (!val) return defaultVal;
  return val === 'true' || val === '1' || val === 'yes';
}

export function loadConfig(): AppConfig {
  const mode = process.env['HERMES_INTEGRATION_MODE'] || 'mock';

  if (mode === 'live' && !process.env['HERMES_API_KEY']) {
    // In production mode, require explicit reviewed config
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error(
        'Production mode requires HERMES_API_KEY to be set. ' +
        'The application must refuse startup when production mode is selected ' +
        'without an explicit reviewed configuration.'
      );
    }
  }

  const config: AppConfig = {
    port: envInt('PORT', 18790),
    host: process.env['HOST'] || '127.0.0.1',
    logLevel: process.env['LOG_LEVEL'] || 'info',
    hermesIntegrationMode: mode as 'mock' | 'live',
    mobileWriteActionsEnabled: envBool('MOBILE_WRITE_ACTIONS_ENABLED', false),
    pushDeliveryEnabled: envBool('PUSH_DELIVERY_ENABLED', false),
    databaseMode: (process.env['DATABASE_MODE'] as 'test' | 'production') || 'test',
    mockHermesPort: envInt('MOCK_HERMES_PORT', 18642),
    mockHermesHost: process.env['MOCK_HERMES_HOST'] || '127.0.0.1',
    hermesApiKey: process.env['HERMES_API_KEY'] || '',
    hermesGatewayUrl: process.env['HERMES_GATEWAY_URL'] || 'http://127.0.0.1:8642',
    accessTokenExpiryMs: envInt('ACCESS_TOKEN_EXPIRY_MS', 10 * 60 * 1000), // 10 min
    refreshTokenExpiryMs: envInt('REFRESH_TOKEN_EXPIRY_MS', 30 * 24 * 60 * 60 * 1000), // 30 days
    allowedEmails: (process.env['ALLOWED_OPERATOR_EMAILS'] || '').split(',').filter(Boolean),
    databaseUrl: process.env['DATABASE_URL'] || '',
    sidecarBindAddress: process.env['SIDECAR_BIND_ADDRESS'] || '127.0.0.1:8790',
  };

  return config;
}

export type { AppConfig };
export default loadConfig;
