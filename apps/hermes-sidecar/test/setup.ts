// ── Test Setup ──
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';

// Load test .env before anything else
dotenvConfig({ path: resolve(__dirname, '../.env'), override: true });

// Set test defaults
process.env['HERMES_INTEGRATION_MODE'] = 'mock';
process.env['DATABASE_MODE'] = 'test';
process.env['HERMES_API_KEY'] = 'test_mock_key';

// Increase timeouts
process.env['TEST_TIMEOUT'] = '15000';
