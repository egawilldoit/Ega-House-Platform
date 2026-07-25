# Testing and Validation

Use commands from manifests, not remembered test counts. Run from the stated directory and report exact exit codes.

## Evidence labels

- `STRUCTURAL PASS`: file shape, links, metadata, instruction-chain structure, or source-pattern checks passed.
- `COMMAND DECLARED`: the manifest contains the command; the command was not necessarily executed successfully.
- `FILE EXISTS`: the documented path exists; behavior was not executed.
- `DISCOVERY VERIFIED`: the installed tool reported the instruction/skill under the tested profile.
- `RUNTIME NOT VERIFIED`: no runtime or external-system conclusion is supported.

The agent-context validator does not establish semantic documentation accuracy, runtime architecture correctness, command success, Codex semantic skill routing, Hermes skill routing, or external-system state.

## Validation matrix

| Change type | Minimum validation | Additional validation |
|---|---|---|
| Agent context/docs/skills | `npm run validate:agent-context` | Inspect final diff and run Codex/Hermes discovery when available |
| Root web code | `npm run typecheck`, `npm run lint`, targeted `npm test -- <pattern>` | Full `npm test`, `npm run build` |
| Auth/session | Targeted unit tests | `npm run test:auth-session:e2e` with configured credentials |
| Database schema/migration | Generate/inspect SQL only when intentionally changing schema | Controlled migration against disposable database |
| Agent task API | Targeted Vitest service/handler tests, typecheck | Full root test/build |
| Mobile | `cd apps/mobile && npm run typecheck && npm test` | `npm run doctor`, `npm run validate:bundle`, controlled prebuild |
| Runner TypeScript | `cd scripts/ega-runner && npm run typecheck` | Runner contract tests below |
| Queue/lease | `node scripts/ega-runner/test/execution-contract.test.mjs` | Disposable Postgres/PGMQ duplicate, lease-loss, crash/retry scenarios |
| Worktree/Git | `node scripts/ega-runner/test/worktree-cleanup.test.mjs` | Temporary real Git repository with collision/stale-path cases |
| Hermes adapter | `node scripts/ega-runner/test/hermes-executor.test.mjs` | `npm run preflight:hermes-skills` under the actual Runner service profile; controlled Hermes smoke |
| Automation schema | `node scripts/ega-runner/test/schema-preflight.test.mjs` | Integration with disposable database |
| Full Runner smoke | `cd scripts/ega-runner && npm run smoke` | Supervised run with approved real integrations |

## Agent-context commands

```bash
npm ci
npm run test:agent-context
node --check scripts/agent/validate-agent-context.mjs
node --check scripts/agent/preflight-hermes-skills.mjs
npm run validate:agent-context
```

`validate:agent-context` runs the focused tests first, then structural validation.

## Root commands

```bash
npm ci
npm run validate:agent-context
npm run typecheck
npm run lint
npm test
npm run build
```

Run `npm ci` only in a clean isolated checkout/worktree when replacing `node_modules` could destroy unrelated work.

## Mobile commands

```bash
cd apps/mobile
npm ci
npm run typecheck
npm test
npm run doctor
npm run validate:bundle
```

Run native prebuild only when native configuration is in scope because clean prebuild can replace generated directories.

## Runner commands

```bash
cd scripts/ega-runner
npm ci
npm run typecheck
node test/execution-contract.test.mjs
node test/hermes-executor.test.mjs
node test/schema-preflight.test.mjs
node test/worktree-cleanup.test.mjs
```

Smoke and integration commands require approved disposable Postgres/PGMQ resources.

## Codex discovery

When Codex CLI is installed, run clean sessions from the repository root and `scripts/ega-runner`. Record the installed version, working directory, instruction files reported, visible skills, and discrepancies. Structural modeling in `validate-agent-context.mjs` is not a substitute for actual CLI discovery.

## Hermes discovery

Run under the same OS user, environment, and working directory as the Runner service:

```bash
npm run preflight:hermes-skills
```

The preflight is read-only. It checks the installed CLI, required skill names, and local-shadow risk. It never edits `~/.hermes/config.yaml`.

## Evidence standard

For every executed command report the exact command/directory, exit code, relevant totals, credentials/external services involved, evidence class, and skipped checks. Never claim a command passed when it was not run.
