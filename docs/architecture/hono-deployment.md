# Hono API Server Deployment (`@ega/server`)

Status: **DEPLOYMENT CONFIG READY** (2026-08, hardening Task 3). The
configuration below is complete, locally proven, and CI-validated. No
deployment exists yet because this environment holds no provider credentials;
the exact external requirements are listed in [External blockers](#external-blockers).

## Decision

V1 hosting target for `apps/server`: **Vercel Functions via the `hono/vercel`
adapter**, deployed as a second Vercel project with Root Directory =
`apps/server`, fronted by a dedicated origin (`https://ega-api.egawilldoit.online`).

Two entrypoints share one application factory:

| File | Runtime | Role |
| --- | --- | --- |
| `apps/server/api/index.ts` | Vercel Functions (Node.js runtime, Fluid compute) | Production deployment entrypoint. Exports `GET`/`POST`/… built with `handle()` from the `hono/vercel` adapter shipped inside `hono` itself. |
| `apps/server/src/serve.ts` | Long-lived Node process (`@hono/node-server`) | Local/dev runtime only (`npm run dev --workspace @ega/server`). Owns `PORT` parsing and the SIGTERM/SIGINT drain. |

Both wrap the same `createProductionApp()`, so routing, bearer auth,
`GET /health`, `GET /ready`, and JSON error shapes are identical across
runtimes.

### Options considered

| Criterion | A. Long-lived container (Dockerfile + generic host) | B. Vercel Functions (chosen) |
| --- | --- | --- |
| Platform precedent | None: repo runs zero containers; would introduce a new vendor relationship (Fly/Railway/VPS) | Web app already deploys on Vercel through the GitHub integration; DNS for `egawilldoit.online` already on Vercel |
| Local provability here | Zero: Docker CLI present but daemon socket permission-denied, so no build/boot proof possible | Full: the real entrypoint module boots under Node 22 and answers `/health`, `/ready`, 401 proofs (CI-tested) |
| Cold starts | None | Present but mitigated by Fluid compute concurrency; acceptable for low-traffic personal API |
| Long-lived process / background work | Native | Not supported: scale-to-zero, per-invocation `maxDuration` (set to 30s in `apps/server/vercel.json`; platform ceiling 300s default) |
| Graceful shutdown (SIGTERM drain in `serve.ts`) | Preserved as written | No equivalent; platform recycles instances without app-controlled draining |
| `/ready` semantics | Real orchestrator gate | Callable probe only; Vercel performs no health-check orchestration. With unreachable Supabase it returns 503 `{status:"unavailable"}` |
| Env var injection | Provider-specific files/secrets UI | Vercel project environment variables (Production + Preview), same names |
| HTTPS/custom domain | Manual (certs, ingress) | Automatic; assign `ega-api.egawilldoit.online` in project domains |
| Logs | Provider-dependent | Built-in runtime logs + Observability per function |
| Supabase compatibility | Pure HTTP — fine | Pure HTTP — fine |
| CORS | n/a today (native `fetch` clients don't enforce CORS; web calls its own origin) | Same; no CORS middleware added deliberately |
| Deploy flow | Manual CI wiring needed | Existing Git integration deploys on push; monorepo Root Directory isolates builds |

Sources consulted (current official docs): Hono getting started /
[Vercel](https://hono.dev/docs/getting-started/vercel);
[hono/vercel adapter shipped in hono 4.x](https://www.npmjs.com/package/hono)
(`exports["./vercel"]`, locked at 4.12.32 in `package-lock.json`);
Vercel [Hono on Vercel](https://vercel.com/docs/frameworks/backend/hono),
[Ship a Hono app](https://vercel.com/kb/guide/ship-a-hono-app-on-vercel),
[Vercel Functions limits](https://vercel.com/docs/functions/limitations),
and [Using Monorepos](https://vercel.com/docs/monorepos) (Root Directory +
npm-workspaces change detection).

Revisit Option A only if cold starts or duration caps demonstrably hurt
(timer-heavy interactive loops are short request/response today).

## Environment contract

Read at runtime by `src/env.ts` (never baked into the build):

| Variable | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | yes (or fallback) | Valid http(s) URL of the Supabase project |
| `SUPABASE_ANON_KEY` | yes (or fallback) | Anon/publishable key used to verify user tokens |
| `NEXT_PUBLIC_SUPABASE_URL` | fallback | Accepted when `SUPABASE_URL` unset |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | fallback | Accepted when `SUPABASE_ANON_KEY` unset |
| `PORT` | serve.ts only | 1–65535, default 3001. Ignored by the Vercel function |

Missing values make both entrypoints refuse to start with explicit errors
(proven in `apps/server/test/vercel-entrypoint.test.ts`). Placeholders live in
tracked `apps/server/.env.example`; never commit real values.

## Deployment runbook (owner actions)

1. In Vercel, **Add New → Project**, import the same Git repository, set
   **Root Directory** to `apps/server`. Framework preset: Other/Hono
   auto-detection applies; `apps/server/vercel.json` supplies rewrites
   (`/(.*)` → `/api/index`) and `maxDuration: 30`.
2. Set project environment variables (Production + Preview):
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
3. Assign domain `ega-api.egawilldoit.online` to the project. The zone is
   already on Vercel DNS, so this creates the record without external DNS work.
4. First deploy proves or disproves the one unproven step below; then run
   L8: `MOBILE_PRODUCTION_BASE_URL=https://ega-api.egawilldoit.online npm run verify:mobile -- --levels 8`.

### What is proven vs unproven

Proven (local + CI): entrypoint module initializes only with valid env shape;
boots and serves over HTTP; `/health` 200; `/ready` dependency-probe path
returns 503 against placeholder credentials; canonical `/api/*` returns 401
without bearer token; 404 JSON shape; `vercel.json` rewrite/function config
validity; full server typecheck/test suite.

Unproven until first owner deploy: actual Vercel build of the function
(including npm-workspaces TypeScript sources under `packages/*` resolved
during Vercel's bundling), custom-domain TLS issuance, and end-to-end traffic.
If Vercel's bundler fails to trace workspace `.ts` exports, the fallback is an
esbuild bundle step declared in `apps/server/vercel.json` (`buildCommand`) —
decide then, not speculatively now.

## Mobile base URL wiring

Mobile resolves ONE base URL for every API call
(`apps/mobile/lib/api/client.ts`: `EXPO_PUBLIC_API_BASE_URL` → dev-host →
release fallback). Production convention decided here:

- Dedicated Hono origin: `https://ega-api.egawilldoit.online`
  (**REQUIRES DNS/provider setup** — not live until the runbook above is done).
- Release-build fallback stays `https://www.egawilldoit.online` for now. Do
  NOT flip release builds to the new origin yet: mobile still calls legacy
  Next.js paths (`/api/mobile/tasks*`, `/api/mobile/today*`) that exist only
  on the web origin. Task 5 migrates those into the Hono server; flip
  `EXPO_PUBLIC_API_BASE_URL` in EAS/release config as part of that cutover.
- Misconfiguration keeps failing diagnostically: invalid URLs throw at resolve
  time, release builds warn once on fallback, and network errors surface
  actionable messages naming `EXPO_PUBLIC_API_BASE_URL`
  (`apps/mobile/lib/api/__tests__/client-base-url.test.ts`).

L8 guidance: point `MOBILE_PRODUCTION_BASE_URL` at the dedicated Hono origin,
never at the web origin (`/health` exists only on the Hono server).

## External blockers

- WHAT: deploy the second Vercel project, issue `ega-api.egawilldoit.online`,
  inject secrets.
- WHY: no Vercel credentials/account access exists in this VM (`vercel whoami`
  fails with no stored credentials), so nothing can be linked or deployed here.
- EXACT REQUIREMENT (owner): perform the four runbook steps above — project
  creation with Root Directory `apps/server`, `SUPABASE_URL` +
  `SUPABASE_ANON_KEY` injection, domain assignment, first production deploy.
