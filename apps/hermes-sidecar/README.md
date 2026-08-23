# Hermes Mobile Sidecar

Secure gateway between the Hermes Agent and mobile Android devices.

## Quick Start

```bash
cd apps/hermes-sidecar
cp .env.example .env   # Edit if needed
npm install
npm run dev            # Starts on 127.0.0.1:18790
```

## Modes

### Safe Development Mode (default)

- `HERMES_INTEGRATION_MODE=mock` — uses a mock Hermes Gateway (no production credentials needed)
- `PORT=18790` — development-only port
- All write actions disabled
- OpenAPI docs at `/docs` (dev only)
- Binds only to `127.0.0.1`

### Production Mode

Requires explicit configuration:
```env
HERMES_INTEGRATION_MODE=live
HERMES_GATEWAY_URL=http://127.0.0.1:8642
HERMES_API_KEY=your_production_key
```

The app refuses startup in production mode without a reviewed config.

## Project Structure

```
apps/hermes-sidecar/
├── src/
│   ├── main.ts                 # Entry point
│   ├── app.ts                  # Fastify app assembly
│   ├── routes/
│   │   ├── health.ts           # /health, /ready
│   │   ├── hermes.ts           # /v1/hermes/*
│   │   ├── sessions-jobs.ts    # /v1/sessions, /v1/jobs
│   │   └── mobile.ts           # /v1/mobile/*
│   ├── lib/
│   │   ├── config.ts           # Configuration loader
│   │   ├── logger.ts           # Pino logger with redaction
│   │   ├── hermes-client.ts    # Typed Hermes Gateway client
│   │   ├── mock-hermes.ts      # Mock Hermes server for tests
│   │   └── security-boundary.ts # Forbidden path enforcement
│   ├── types/
│   │   └── hermes.ts           # TypeScript type definitions
│   └── fixtures/               # Test fixtures (TBD)
├── db/migrations/
│   └── 001_initial_schema.sql  # 13 tables (NOT applied)
├── test/
│   ├── setup.ts                # Test environment config
│   ├── routes.test.ts          # Route integration tests (17)
│   └── security.test.ts        # Security-negative tests (17)
├── scripts/
│   └── generate-openapi.ts     # OpenAPI spec generator
├── openapi.json                # Generated OpenAPI 3.0 spec
├── .env                        # Dev environment config
├── vitest.config.ts
└── package.json
```

## Endpoints

### Public (no auth)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe (DB + Hermes check) |

### Protected (device token auth)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/hermes/status` | Hermes Gateway health |
| GET | `/v1/hermes/capabilities` | Hermes capabilities |
| GET | `/v1/hermes/models` | Available models |
| GET | `/v1/hermes/skills` | Installed skills |
| GET | `/v1/hermes/toolsets` | Enabled toolsets |
| GET | `/v1/sessions` | List Hermes sessions |
| GET | `/v1/sessions/:id` | Get session details |
| GET | `/v1/sessions/:id/messages` | Session messages |
| GET | `/v1/jobs` | List cron jobs |
| GET | `/v1/jobs/:id` | Get job details |
| GET | `/v1/mobile/alerts` | Mobile alerts |
| POST | `/v1/mobile/devices/register` | Register device |
| DELETE | `/v1/mobile/devices/:id` | Deregister device |

### Write Routes (disabled by default)
| Method | Path | Protection |
|--------|------|------------|
| POST | `/v1/hermes/chat` | Behind `MOBILE_WRITE_ACTIONS_ENABLED=true` |

## Security

### Forbidden Paths
The following patterns return 404 at the router level:
- `/proxy/*` — generic proxy
- `/hermes/*` — direct gateway exposure
- `/shell`, `/exec`, `/command` — command execution
- `/arbitrary-url` — URL fetch
- `/graphql`, `/debug`, `/_internal/*`

### Log Redaction
Pino automatically redacts: `authorization`, `access_token`, `refresh_token`, `api_key`, `secret`, `token`, `password`, `key`, and `env.*_*KEY*`/`env.*_*TOKEN*`/`env.*_*SECRET*` patterns.

### Upstream Error Redaction
Hermes Gateway errors (stack traces, API keys, error details) are replaced with generic "Upstream unavailable" messages.

## Running Tests

```bash
npm test             # All 34 tests
npm run test:watch   # Watch mode
npm run typecheck    # TypeScript check only
```

Tests use a mock Hermes Gateway server (no production connection needed).

## Database Migrations

Migration files are in `db/migrations/` and are **NOT applied automatically**.

```bash
# To apply (requires Supabase/Postgres):
# psql $DATABASE_URL -f db/migrations/001_initial_schema.sql
```

The sidecar uses an isolated `mobile_sidecar` schema — no conflict with the main `public` schema.

## Deployment Plan (Not Executed)

1. Build: `npm run build` (emits to `dist/`)
2. Copy to target: `/opt/hermes-sidecar/`
3. Create systemd unit: `ega-hermes-sidecar.service` (draft in `docs/systemd/`)
4. Create hermes-sidecar user (uid 998, already done on openclaw)
5. Set `HERMES_INTEGRATION_MODE=live` + `HERMES_API_KEY`
6. Start with `systemctl start ega-hermes-sidecar.service`
7. Bind: `127.0.0.1:8790`
8. Activate cloudflared tunnel ingress for `mobile-auth` and `mobile-api`
