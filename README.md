## EGA House Platform

EGA House is a productivity platform organized as an npm-workspace monorepo: a Next.js web application, an Expo mobile application, a standalone Hono API, shared domain/application/data packages, and agent-facing MCP/OAuth integrations.

## Product surfaces

- Web workspace: `apps/web` — tasks, goals, timer, review, analytics, integrations, and compatibility Agent/MCP/OAuth/Cron routes.
- Mobile client: `apps/mobile` — Expo native client using the authenticated standalone API.
- Standalone API: `apps/server` — Hono Auth/Timer/Projects/Goals/Tasks/Today transport; deployment contract in [`docs/architecture/hono-deployment.md`](docs/architecture/hono-deployment.md).
- Shared product authority: `packages/domain`, `packages/contracts`, `packages/application`, `packages/data-access`, and `packages/api-client`.
- Database/migration authority: root `src/db`, `drizzle/`, and `drizzle.config.ts`.
- Agent task-control API: compatibility surface under `apps/web/src/app/api/agent`.
- MCP / OAuth / integration surfaces: type-safe tool and auth layers under `apps/web/src/lib/mcp` and `apps/web/src/lib/oauth`.

## Product and architecture context

Start with:

1. [`CONTEXT.md`](CONTEXT.md) — Project → Goal → Task → Timer → Review mental model.
2. [`ARCHITECTURE.md`](ARCHITECTURE.md) — current system map.
3. [`docs/architecture/platform-monorepo.md`](docs/architecture/platform-monorepo.md) — workspace/package boundaries.

Canonical web workspace routes include `/tasks`, `/goals`, `/timer`, and `/review`; compatibility redirects may still exist. Protected routes require authentication.

## Development

```bash
npm ci
npm run dev
```

The root lockfile is authoritative for `apps/*` and `packages/*`.

## Validation

```bash
npm run validate:agent-context
npm run check:architecture
npm run typecheck
npm run lint
npm test
npm run build
```

Platform package, server, and mobile commands are listed in [`docs/agent-context/testing-and-validation.md`](docs/agent-context/testing-and-validation.md). Report exact current command results rather than preserving test/page counts as permanent baselines.

## Agent-assisted development

Start with [`AGENTS.md`](AGENTS.md). It is the repository-wide governance map. [`CONTEXT.md`](CONTEXT.md) supplies the product mental model; [`docs/agent-context/product-authority.md`](docs/agent-context/product-authority.md) separates current-behavior evidence from normative product authority; [`docs/agent-context/decision-log.md`](docs/agent-context/decision-log.md) persists material conflict classifications; [`docs/agent-context/tooling-map.md`](docs/agent-context/tooling-map.md) records how each agent harness loads repository guidance.
