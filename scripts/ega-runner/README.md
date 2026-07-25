# EGA Runner

The EGA Runner is a **partially implemented** durable PGMQ consumer for the EGA House autonomous-delivery pipeline. It provides a meaningful queue-to-GitHub vertical slice, but it does not prove the full webhook → checks → Vercel preview → merge → deployment lifecycle.

Read the repository-wide authority first:

- [`../../AGENTS.md`](../../AGENTS.md)
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md)
- [`../../docs/agent-context/product-authority.md`](../../docs/agent-context/product-authority.md)
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

## Implemented current behavior

- `pgmq.read()` with visibility timeout.
- Explicit claim outcomes and atomic queued → preparing claim.
- DB lease plus PGMQ visibility heartbeat.
- Event persistence in `automation.implementation_events`.
- Real Linear GraphQL lookup when `LINEAR_API_KEY` is configured; bounded mock mode for test/development.
- Authorized-path extraction and scope enforcement.
- Deterministic branch/worktree identifiers.
- Bounded Hermes CLI execution and result-file recovery.
- Actual changed-file, Git ancestry, commit, push, and remote-SHA verification.
- GitHub commit status and PR creation attempt.
- Local evidence directory and manifest.
- Slack operational reporting.

## Known current gaps

- PR existence is not a prerequisite for the current `completed` database state.
- `waitForChecks()` and `verifyVercelDeployment()` are not called by the terminal path.
- Reported validations are not independently rerun by Runner.
- Lease/heartbeat loss does not immediately terminate Hermes or fence every side effect.
- Existing branches can be force-reset and worktrees are added with `--force`.
- Linear project membership is hardcoded and blocker semantics are not proven against blocked-by relations.
- Existing PR lookup/idempotent PR synchronization is absent.
- Reconciliation, dead-letter policy, and automatic stale-attempt recovery are absent.
- The complete automation base schema and signed webhook are not fully versioned here.
- The deployed Runner profile has not yet proven repository-local Hermes skill visibility.

Treat `automation.implementation_runs.status='completed'` as current Runner-path completion, not proof of PR/check/preview/merge/deployment completion.

## Hermes skill preflight

Hermes repository skill discovery is environment-dependent. Before operating the Runner, execute the read-only preflight under the same service user, environment, and working directory:

```bash
cd /absolute/path/to/Ega-House-Platform
npm run preflight:hermes-skills
```

When external discovery is required, configure the same service user's `~/.hermes/config.yaml`:

```yaml
skills:
  external_dirs:
    - /absolute/path/to/Ega-House-Platform/.agents/skills
```

Do not commit or print the rest of that user-global configuration. Local same-name Hermes skills shadow repository external skills; the preflight treats that as unverified.

## Commands

```bash
cd scripts/ega-runner
npm ci
npm run typecheck
npm start
```

Smoke mode mutates approved test records and requires a disposable Postgres/PGMQ environment:

```bash
cd scripts/ega-runner
npm run smoke
```

## Required environment

- `DATABASE_URL`: Postgres with deployed `automation.*` tables and PGMQ queue.
- `LINEAR_API_KEY`: required for real-issue context resolution.
- Hermes CLI available on `PATH` with successful repository-skill preflight.
- Authenticated `gh` CLI and configured Git remote.
- Optional reporting/integration credentials such as Slack and Vercel tokens.

See `src/config.ts` for variable names and defaults. Do not copy secret values into documentation, logs, prompts, or evidence.

## Queue and ownership invariants

- Never introduce executable `pgmq.pop()` calls.
- Preserve work on ambiguity, exception, claim race, or inconsistent state.
- Archive only after the relevant durable classification is persisted.
- Treat `claimed_by` and `lease_expires_at` as temporary ownership.
- Do not perform new side effects after ownership is uncertain.
- Do not work on `main`.
- Do not trust Hermes prose, exit status, or result JSON as proof.
- Do not reuse or force-reset stale branches/worktrees; current code violates this rule.
- Do not claim end-to-end delivery success without required PR, checks, preview, and durable evidence.

## Validation

Use the Runner matrix in [`../../docs/agent-context/testing-and-validation.md`](../../docs/agent-context/testing-and-validation.md). Static validation does not prove a production-style delivery.
