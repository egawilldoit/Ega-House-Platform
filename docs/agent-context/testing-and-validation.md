# Testing and Validation

Use commands from manifests, not remembered test counts. Run from the stated directory.

## Validation matrix

| Change type | Minimum validation | Additional validation |
|---|---|---|
| Agent context/docs/skills | `npm run validate:agent-context` | Review all local links and final diff |
| Root web code | `npm run typecheck`, `npm run lint`, targeted `npm test -- <pattern>` | Full `npm test`, `npm run build` |
| Auth/session | Targeted unit tests | `npm run test:auth-session:e2e` with configured credentials |
| Database schema/migration | `npm run db:generate` only when intentionally changing schema; inspect SQL | Controlled migration against disposable database |
| Agent task API | Targeted Vitest service/handler tests, typecheck | Full root test/build |
| Mobile | `cd apps/mobile && npm run typecheck && npm test` | `npm run doctor`, `npm run validate:bundle`, controlled prebuild |
| Runner TypeScript | `cd scripts/ega-runner && npm run typecheck` | Runner contract tests below |
| Queue/lease | `node scripts/ega-runner/test/execution-contract.test.mjs` and relevant integration tests | Disposable Postgres/PGMQ duplicate, lease-loss, crash/retry scenarios |
| Worktree/Git | `node scripts/ega-runner/test/worktree-cleanup.test.mjs` | Temporary real Git repository with branch collision and stale path cases |
| Hermes adapter | `node scripts/ega-runner/test/hermes-executor.test.mjs` | Controlled Hermes smoke run in disposable worktree |
| Automation schema | `node scripts/ega-runner/test/schema-preflight.test.mjs` | `node scripts/ega-runner/test/pipeline-integration.mjs` with disposable DB |
| Full Runner smoke | `cd scripts/ega-runner && npm run smoke` | Supervised run with real Linear, GitHub, Vercel, and Slack credentials |
| GitHub/Slack workflow | Syntax and focused script review | Test PR/channel only; never production merge as validation |

## Root commands

```bash
npm ci
npm run validate:agent-context
npm run typecheck
npm run lint
npm test
npm run build
```

`npm ci` is required on a clean CI/validation environment. Do not run it inside an active environment where replacing `node_modules` would destroy unrelated work without approval.

## Mobile commands

```bash
cd apps/mobile
npm ci
npm run typecheck
npm test
npm run doctor
npm run validate:bundle
```

Run Android/iOS prebuild only when native configuration is in scope because `--clean` is destructive to generated native directories.

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

The smoke and integration commands require Postgres/PGMQ and can mutate automation test records. Use a disposable or explicitly approved environment.

## Evidence standard

For every command report:

- exact command and directory,
- exit code,
- relevant pass/fail totals,
- whether credentials/external services were involved,
- whether the result is static, integration, or runtime evidence,
- known skipped checks.

Never claim a command passed when it was not run. Never translate a static typecheck into runtime verification.
