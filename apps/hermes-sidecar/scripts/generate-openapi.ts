// ── OpenAPI Specification Generator ──
// Run: npx tsx scripts/generate-openapi.ts

import { loadConfig } from '../src/lib/config.js';
import { buildApp } from '../src/app.js';
import { HermesClient } from '../src/lib/hermes-client.js';
import { MockHermesServer } from '../src/lib/mock-hermes.js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function generateOpenApi(): Promise<void> {
  const config = loadConfig();
  
  // Start mock Hermes server
  const mockServer = new MockHermesServer(config);
  await mockServer.start();
  
  // Build the app (registers routes with Swagger)
  const app = await buildApp({
    config,
    hermesClient: new HermesClient(config),
  });
  await app.ready();

  // Generate OpenAPI spec
  const swagger = app.swagger();
  
  const outputPath = resolve(import.meta.dirname, '..', 'openapi.json');
  writeFileSync(outputPath, JSON.stringify(swagger, null, 2));
  console.log(`OpenAPI spec written to ${outputPath}`);
  
  await app.close();
  await mockServer.stop();
}

generateOpenApi().catch(console.error);
