# Testing and Validation

Use commands from manifests, not remembered test counts. Run from the stated directory and report exact exit codes.

## Evidence labels

- `STRUCTURAL PASS`: file shape, links, metadata, instruction-chain structure, or source-pattern checks passed.
- `COMMAND DECLARED`: the manifest contains the command; it was not necessarily successful.
- `FILE EXISTS`: the path exists; behavior was not executed.
- `DISCOVERY VERIFIED`: the installed tool reported the instruction/skill under the tested profile.
- `RUNTIME NOT VERIFIED`: no runtime or external-system conclusion is supported.

Structural validation does not establish runtime architecture, command success, semantic skill routing, or external-system state.

## Validation matrix

| Change type | Minimum validation | Additional validation |
|---|---|---|
| Agent context/docs/skills | `npm run validate:agent-context` | Inspect final diff and run Codex/Hermes discovery when available |
| Root web code | `npm run typecheck`, `npm run lint`, targeted tests | Full `npm test`, `npm run build` |
| Database schema/migration | SQL and journal inspection | Controlled migration against disposable database |
| Runner TypeScript | `npm run typecheck:ega-runner` | Focused Runner tests and real integrations |
| PR monitor/repair graph | `npm run test:ega-runner-pr-loop` | GitHub fixture/integration tests with >100 checks/statuses and concurrent monitor workers |
| Queue/lease | `node scripts/ega-runner/test/execution-contract.test.mjs` | Disposable Postgres/PGMQ duplicate, lease-loss, crash/retry scenarios |
| Worktree/Git | `node scripts/ega-runner/test/worktree-cleanup.test.mjs` | Temporary real Git repository with malicious refs, collision/stale-path, dirty/untracked evidence cases |
| Hermes adapter | `node scripts/ega-runner/test/hermes-executor.test.mjs` | Preflight under Runner user; controlled initial/recovery/repair smoke |
| Automation schema | `node scripts/ega-runner/test/schema-preflight.test.mjs` | Apply/rollback against disposable database |
| Full Runner | `cd scripts/ega-runner && npm run smoke` | Authorized real ticket through `READY_TO_MERGE` |

## Agent-context commands

```bash
npm ci
npm run test:agent-context
node --check scripts/agent/validate-agent-context.mjs
node --check scripts/agent/preflight-hermes-skills.mjs
npm run validate:agent-context
```

## Root commands

```bash
npm ci
npm run validate:agent-context
npm run typecheck:ega-runner
npm run test:ega-runner-pr-loop
npm run typecheck
npm run lint
npm test
npm run build
```

Run `npm ci` only in a clean isolated checkout/worktree.

## Runner commands

```bash
cd scripts/ega-runner
npm ci
npm run typecheck
npm run test:pr-loop
node test/execution-contract.test.mjs
node test/hermes-executor.test.mjs
node test/schema-preflight.test.mjs
node test/worktree-cleanup.test.mjs
```

The focused PR-loop suite contains 20 cases covering state policy, source invariants, and disposable-Git worktree safety. It does not replace live GitHub pagination/concurrency tests, database migration proof, or live Hermes execution.

## Codex discovery

When Codex CLI is installed, run clean sessions from the repository root and `scripts/ega-runner`. Record version, working directory, instruction files, visible skills, and discrepancies. Structural modeling is not actual CLI discovery.

## Hermes discovery

Run under the same OS user/profile as the Runner service:

```bash
npm run preflight:hermes-skills
```

The preflight is read-only and never edits user configuration.

## E2E proof

A real low-risk ticket must prove:

```text
ready-for-hermes
→ one queued run
→ isolated implementation
→ Runner validation
→ verified PR_OPEN
→ check/review observation
→ at least one controlled repair case
→ READY_TO_MERGE
→ human merge
```

For every command report the exact directory, exit code, totals, credentials/external services, evidence class, and skipped checks. Never claim success for a command or platform that was not executed.
