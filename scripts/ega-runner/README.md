# EGA Runner

The EGA Runner is a **partially implemented** durable PGMQ consumer for the EGA House autonomous-delivery pipeline. It provides a meaningful queue-to-GitHub vertical slice, but it does not yet prove the full Linear webhook → checks → Vercel preview → merge → deployment lifecycle.

Read the repository-wide authority first:

- [`../../AGENTS.md`](../../AGENTS.md)
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md)
- [`../../docs/architecture/delivery-lifecycle.md`](../../docs/architecture/delivery-lifecycle.md)
- [`../../docs/architecture/queue-and-leases.md`](../../docs/architecture/queue-and-leases.md)
- [`../../docs/architecture/runner-and-worktrees.md`](../../docs/architecture/runner-and-worktrees.md)
- [`../../docs/architecture/hermes-execution.md`](../../docs/architecture/hermes-execution.md)

## Current execution path

```text
PGMQ message
→ classify and atomically claim automation.implementation_runs
→ establish DB lease and queue visibility timeout
→ resolve Linear issue/parent context
→ recheck current authorization logic
→ extract authorized paths
→ pin base SHA and create branch/worktree
→ invoke Hermes CLI
→ preserve stdout/stderr/result artifacts
→ verify actual changed paths and implementation commit
→ push branch and compare remote SHA
→ publish commit status
→ attempt GitHub PR creation
→ persist evidence and current run terminal state
→ report to Slack
→ archive eligible queue message
```

## What is implemented

- `pgmq.read()` with visibility timeout.
- Explicit claim outcomes and atomic queued → preparing claim.
- DB lease plus PGMQ visibility heartbeat.
- Event persistence in `automation.implementation_events`.
- Real Linear GraphQL lookup when `LINEAR_API_KEY` is configured; bounded mock mode only for test/development.
- Authorized-path extraction and scope enforcement.
- Deterministic branch/worktree identifiers.
- Bounded Hermes CLI execution and result-file recovery.
- Actual changed-file, Git ancestry, commit, push, and remote-SHA verification.
- GitHub commit status and PR creation attempt.
- Local evidence directory and manifest.
- Slack operational reporting.

## What is not yet enforced

- PR existence is **not** a prerequisite for the current `completed` database state. PR creation failure is logged and execution continues.
- `waitForChecks()` exists but is not called by the current terminal path.
- `verifyVercelDeployment()` exists but is not called by the current terminal path.
- Required validations are reported by Hermes and inspected, but are not independently rerun by the Runner.
- Lease/heartbeat failure does not immediately terminate active Hermes work or fence every external side effect.
- Existing deterministic branches can be force-reset and worktrees are added with `--force`; stale-attempt isolation is incomplete.
- Linear project membership is currently hardcoded, and blocker semantics are not proven against Linear blocked-by relations.
- Existing PR lookup/idempotent PR synchronization is absent.
- Reconciliation, dead-letter policy, and automatic stale-attempt recovery are absent.
- The complete automation base schema and signed webhook implementation are not fully versioned in this repository.

Therefore, treat `automation.implementation_runs.status='completed'` as **current Runner-path completion**, not proof of PR/check/preview/merge/deployment completion.

## Commands

```bash
cd scripts/ega-runner
npm ci
npm run typecheck
npm start
```

Smoke mode requires an approved disposable Postgres/PGMQ environment because it claims, updates, cancels, and archives a test run:

```bash
cd scripts/ega-runner
npm run smoke
```

## Required environment

- `DATABASE_URL`: Postgres with the deployed `automation.*` tables and PGMQ queue.
- `LINEAR_API_KEY`: required for normal real-issue context resolution.
- Hermes CLI available on `PATH`.
- Authenticated `gh` CLI and configured Git remote.
- Optional reporting/integration credentials such as Slack and Vercel tokens.

See `src/config.ts` for current variable names and defaults. Do not copy secret values into documentation, logs, prompts, or evidence.

## Queue and ownership invariants

- Never introduce `pgmq.pop()`.
- Preserve work on ambiguity, exception, claim race, or inconsistent state.
- Archive only after the relevant durable terminal/classification path is persisted.
- Treat `claimed_by` and `lease_expires_at` as temporary ownership, not advisory metadata.
- Do not perform new side effects after ownership is uncertain.
- Do not work on `main`.
- Do not trust Hermes prose, exit status, or result JSON as proof.
- Do not reuse or force-reset stale branches/worktrees; current code violates this and requires correction.
- Do not claim end-to-end delivery success without real PR, required checks, preview, and durable evidence when the contract requires them.

## Validation

Use the Runner matrix in [`../../docs/agent-context/testing-and-validation.md`](../../docs/agent-context/testing-and-validation.md). A production-style smoke delivery requires real external credentials and supervised evidence; static typecheck alone is not runtime validation.
