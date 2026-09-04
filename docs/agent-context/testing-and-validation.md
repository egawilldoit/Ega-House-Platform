# Testing and Validation

Use commands from current manifests and executable scripts, not remembered test/page counts. Run from the stated directory and report exact exit codes/results. A historical count is evidence for that run only.

## Evidence labels

- `STRUCTURAL PASS`: file shape, links, metadata, instruction-chain structure, dependency/source-pattern checks passed.
- `COMMAND DECLARED`: the manifest contains the command; it was not necessarily executed successfully.
- `FILE EXISTS`: the path exists; behavior was not executed.
- `STATIC PASS`: compiler, lint, or static/source checks passed.
- `TEST PASS`: unit/component tests passed; record fixtures/mocks and the boundary exercised.
- `INTEGRATION PASS`: tests crossed the stated real boundary (for example disposable Postgres or HTTP); record environment and limits.
- `DISCOVERY VERIFIED`: the installed agent tool exposed the expected repository instruction/skill under the tested profile.
- `RUNTIME VERIFIED`: the tested runtime/external path produced the stated result under recorded conditions.
- `RUNTIME NOT VERIFIED`: no runtime or external-system conclusion is supported.

Evidence labels describe coverage, not a universal confidence ranking. Structural/static checks and isolated tests do not establish deployment, device, database, cross-user, agent semantic-routing, or external-system state. A test proves only the boundary and scenarios actually exercised. Historical labels remain historical.

Use the [quality workflow](quality-workflow.md) for hypothesis-driven investigation, failure cases, independent review, and merge/release decisions. Required acceptance evidence must pass before the corresponding completion claim; optional unavailable checks need an impact statement.

## Validation matrix

| Change type | Minimum validation | Additional validation when affected |
|---|---|---|
| Agent context/docs/skills | `npm run validate:agent-context` | Inspect final diff; Codex/OpenCode/Hermes discovery under the real profile when available |
| Platform architecture/boundaries | `npm run check:architecture`, `npm run test:architecture` | `npm run ci:purity`, `npm run ci:security`, `npm run ci:workspace` |
| Web (`apps/web`) | `npm run web:typecheck`, targeted `npm run web:test` | `npm run lint:changed`, full `npm run web:test`, `npm run web:build` |
| Hono server (`apps/server`) | `npm run server:typecheck`, `npm run server:test` | Deployment-bundle/health/readiness proof per `docs/architecture/hono-deployment.md` |
| Domain/contracts | matching `domain:*` / `contracts:*` typecheck + test | Architecture/purity checks when dependencies change |
| Application/data access | matching `application:*` / `data-access:*` typecheck + test | Server/web integration tests; RLS proof for authorization-sensitive changes |
| API client | `npm run api-client:typecheck`, `npm run api-client:test` | Mobile/server integration for changed endpoints |
| Mobile (`apps/mobile`) | `npm run mobile:typecheck`, `npm run mobile:test` | `npm run verify:mobile` levels required by the change; bundle/prebuild/device/runtime proof as applicable |
| Database schema/migration | SQL/journal inspection + controlled application against a disposable database | Relevant existing-data upgrade path, affected invariants/RLS and package/server/web tests; rollout/recovery assessment |
| Runner TypeScript | `npm run typecheck:ega-runner` | Focused Runner tests and real integrations |
| PR monitor/repair graph | `npm run test:ega-runner-pr-loop` | GitHub fixture/integration tests including pagination/concurrency edge cases |
| Queue/lease | `node scripts/ega-runner/test/execution-contract.test.mjs` | Disposable Postgres/PGMQ duplicate, lease-loss, crash/retry scenarios |
| Worktree/Git | `node scripts/ega-runner/test/worktree-cleanup.test.mjs` | Temporary real Git repository with malicious refs/collisions/stale/dirty evidence cases |
| Hermes adapter | `node scripts/ega-runner/test/hermes-executor.test.mjs` | `npm run preflight:hermes-skills` under Runner user + controlled Hermes smoke |
| Automation schema | `node scripts/ega-runner/test/schema-preflight.test.mjs` | Apply/rollback against disposable database |
| Full Runner | `cd scripts/ega-runner && npm run smoke` | Authorized real ticket through the contract's review-ready state |

## Selecting and preserving proof

- Map required behavior to evidence before implementation. Run the closest useful
  test first, then affected workspaces and consumers; changed paths alone may
  miss contract, schema, or integration effects.
- Prove a defect regression fails for the actual cause and passes after the fix.
  Mocked/source checks do not substitute for the failing real boundary. Docs-only
  edits need structural and semantic review, not artificial behavioral tests.
- Do not weaken assertions, disable checks, or repeatedly rerun until green.
  Investigate flakiness and local/CI differences. Classify a baseline failure only
  with comparable evidence from the relevant base; pre-existing is not a waiver
  for a required gate.
- Report exact directory, revision, command, result, and relevant environment.
  After changes rerun affected proof; reuse unaffected evidence only with a
  recorded reason and never present an old revision's run as a new one. Repository
  requirements for current-head checks still apply.
- For conditional CI, inspect job conclusions and why each job ran/skipped.
  Skipped is not tested. Use the existing force-full workflow when required by
  scope/release criteria or to resolve an actual coverage gap, not for every typo.
- Agent-context changes require link/command/discovery-budget checks and a semantic
  pass for contradictory authority, scope, approvals, or evidence claims.

## Agent-context commands

From repository root:

```bash
npm ci
npm run test:agent-context
node --check scripts/agent/validate-agent-context.mjs
node --check scripts/agent/preflight-hermes-skills.mjs
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

Focused suites do not replace live GitHub pagination/concurrency proof, database migration proof, or live Hermes execution when those boundaries matter.

## Codex / OpenCode instruction discovery

Root `AGENTS.md` is the repository guidance source. `npm run validate:agent-context` models Codex instruction-chain structure; model output is not proof that a particular installed CLI version loaded it. When discovery itself matters, start a clean session from the repository root/subdirectory, record tool version/CWD, and verify the selected instructions.

OpenCode V2 currently discovers `AGENTS.md`; do not rely on an `opencode.json` `instructions` entry as a substitute unless the installed version proves it resolves that source. See [`tooling-map.md`](tooling-map.md).

## Hermes discovery

Run under the same OS user/profile and repository working directory as the Runner service:

```bash
npm run preflight:hermes-skills
```

The preflight supports trusted project-local discovery as the preferred path and `skills.external_dirs` as a compatibility fallback. It is read-only: it never trusts a repository or edits user configuration. If trust/configuration is missing, the operator must perform that explicit setup action separately.

## E2E delivery proof

A real low-risk ticket should prove the authorized lifecycle rather than a remembered happy-path label. Typical evidence includes:

```text
authorized trigger
→ one durable run / queued message
→ valid claim + lease
→ isolated implementation
→ independent Runner validation
→ verified commit/push/PR
→ required checks/review/preview observation
→ controlled repair path when in scope
→ review-ready durable classification
→ human merge
```

For every command/run report the exact directory, revision, exit code/result, credential role (never values) and external services involved, evidence class, and skipped/unavailable checks. Never claim success for a command or platform that was not executed.
