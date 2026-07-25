## EGA House Platform

EGA House is a productivity platform with a Next.js web application, an Expo mobile application, agent-facing task APIs, and an autonomous-delivery Runner under active development.

## Product surfaces

- Web workspace: tasks, goals, timer, review, analytics, and integrations under `src/`.
- Mobile client: Expo application under `apps/mobile`.
- Agent task-control API: scoped project/goal/task endpoints under `src/app/api/agent`.
- Autonomous Runner: partial Linear/PGMQ/Hermes/GitHub delivery vertical slice under `scripts/ega-runner`.

The Runner is not yet a fully proven end-to-end production delivery system. Read [`ARCHITECTURE.md`](ARCHITECTURE.md) for current/partial/scaffolded/absent classification and known terminal-evidence gaps.

## Route strategy

- Canonical workspace routes: `/tasks`, `/goals`, `/timer`, `/review`.
- `/apps/*` routes are compatibility redirects.
- Protected root/subdomain routes redirect unauthenticated users to `/login?next=...`.

## Development

```bash
npm ci
npm run dev
```

## Validation

```bash
npm run validate:agent-context
npm run typecheck
npm run lint
npm test
npm run build
```

Mobile and Runner validation have separate commands in [`docs/agent-context/testing-and-validation.md`](docs/agent-context/testing-and-validation.md). Report current command results rather than preserving test/page counts as a permanent baseline.

## Agent-assisted development

Start with [`AGENTS.md`](AGENTS.md). It defines repository authority, safety boundaries, scope discipline, validation navigation, and focused skills. [`HERMES_MASTER_PROMPT.md`](HERMES_MASTER_PROMPT.md) is only a thin Hermes entry point; it is not a second product specification.

Current merge policy for Runner-created PRs is human review. `.github/workflows/slack-pr-ready.yml` reports readiness but does not merge. The separate docs-only guardian is controlled automation and must not be treated as general Runner authority.
