# Testing and Validation

Use commands from current manifests and executable scripts, not remembered test/page counts. Run from the stated directory and report exact exit codes/results. A historical count is evidence for that run only.

## Evidence labels

- `STRUCTURAL PASS`: file shape, links, metadata, instruction-chain structure, dependency/source-pattern checks passed.
- `COMMAND DECLARED`: the manifest contains the command; it was not necessarily executed successfully.
- `FILE EXISTS`: the path exists; behavior was not executed.
- `STATIC PASS`: compiler/lint/unit/static checks passed for the executed command.
- `DISCOVERY VERIFIED`: the installed agent tool exposed the expected repository instruction/skill under the tested profile.
- `RUNTIME VERIFIED`: the tested runtime/external path produced the stated result under recorded conditions.
- `RUNTIME NOT VERIFIED`: no runtime or external-system conclusion is supported.

Structural/static validation does not establish deployment, device, database, cross-user, agent semantic-routing, or external-system state unless the executed test actually crosses that boundary.

## Validation matrix

| Change type | Minimum validation | Additional validation when affected |
|---|---|---|
| Agent context/docs/skills | `npm run validate:agent-context` | Inspect final diff; Codex/OpenCode discovery under the real profile when available |
| Platform architecture/boundaries | `npm run check:architecture`, `npm run test:architecture` | `npm run ci:purity`, `npm run ci:security`, `npm run ci:workspace` |
| Web (`apps/web`) | `npm run web:typecheck`, targeted `npm run web:test` | `npm run lint:changed`, full `npm run web:test`, `npm run web:build` |
| Hono server (`apps/server`) | `npm run server:typecheck`, `npm run server:test` | Deployment-bundle/health/readiness proof per `docs/architecture/hono-deployment.md` |
| Domain/contracts | matching `domain:*` / `contracts:*` typecheck + test | Architecture/purity checks when dependencies change |
| Application/data access | matching `application:*` / `data-access:*` typecheck + test | Server/web integration tests; RLS proof for authorization-sensitive changes |
| API client | `npm run api-client:typecheck`, `npm run api-client:test` | Mobile/server integration for changed endpoints |
| Mobile (`apps/mobile`) | `npm run mobile:typecheck`, `npm run mobile:test` | `npm run verify:mobile` levels required by the change; bundle/prebuild/device/runtime proof as applicable |
| Database schema/migration | SQL/journal inspection | Controlled migration against disposable database + affected package/server/web tests |

## Agent-context commands

From repository root:

```bash
npm ci
npm run test:agent-context
node --check scripts/agent/validate-agent-context.mjs
npm run validate:agent-context
npm run check:architecture
npm run test:architecture
```

Run `npm ci` only in a clean isolated checkout/worktree.

## Platform commands

From repository root:

```bash
npm run check:architecture
npm run test:architecture
npm run ci:purity
npm run ci:security
npm run ci:workspace

npm run domain:typecheck && npm run domain:test
npm run contracts:typecheck && npm run contracts:test
npm run application:typecheck && npm run application:test
npm run data-access:typecheck && npm run data-access:test
npm run api-client:typecheck && npm run api-client:test
npm run server:typecheck && npm run server:test
npm run web:typecheck && npm run web:test && npm run web:build
npm run mobile:typecheck && npm run mobile:test
```

Do not substitute the root `typecheck/test/build` aliases for a subsystem-specific command when the task needs proof for multiple workspaces; run the relevant workspace scripts explicitly.

## Codex / OpenCode instruction discovery

Root `AGENTS.md` is the repository guidance source. `npm run validate:agent-context` models Codex instruction-chain structure; model output is not proof that a particular installed CLI version loaded it. When discovery itself matters, start a clean session from the repository root/subdirectory, record tool version/CWD, and verify the selected instructions.

OpenCode V2 currently discovers `AGENTS.md`; do not rely on an `opencode.json` `instructions` entry as a substitute unless the installed version proves it resolves that source. See [`tooling-map.md`](tooling-map.md).

## E2E delivery proof

A real low-risk ticket should prove the authorized lifecycle rather than a remembered happy-path label. Typical evidence includes:

```text
authorized trigger
→ isolated implementation
→ independent validation
→ verified commit/push/PR
→ required checks/review/preview observation
→ human merge
```

For every command/run report the exact directory, revision, exit code/result, credentials/external services involved, evidence class, and skipped/unavailable checks. Never claim success for a command or platform that was not executed.
