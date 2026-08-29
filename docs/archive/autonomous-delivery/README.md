# Autonomous Delivery — Archived

**Status:** Historical / Canceled experiment — not current architecture.
**Retired:** 2026-08-27 via `chore/retire-hermes-runner`.

## What it was

A delivery control plane that turned a Linear issue into a GitHub PR through:

```
Linear → PGMQ → EGA Runner → Hermes → repair → GitHub PR
```

Key runtime:
- `scripts/ega-runner` (queue claim/lease, worktree/branch, Hermes execution, PR monitor/repair)
- PGMQ queue `hermes_implementation_jobs`
- `HERMES_MASTER_PROMPT.md` fallback contract
- `.hermes/` skills, `scripts/agent/preflight-hermes-skills.mjs`, `scripts/hermes-auto-merge-guardian.mjs`
- Runner-specific CI (`typecheck:ega-runner`, `test:ega-runner-pr-loop`) and validator checks

Detailed lifecycle, lease, worktree, and executor contracts previously lived in:

- `docs/architecture/delivery-lifecycle.md`
- `docs/architecture/queue-and-leases.md`
- `docs/architecture/runner-and-worktrees.md`
- `docs/architecture/hermes-execution.md`
- `docs/EGA-001-pipeline-final-proof.md`

Git history preserves the full implementation. See `chore/retire-hermes-runner` diff and `DEC-2026-08-27` in `docs/agent-context/decision-log.md`.

## What remains

- **Migrations retained:** `drizzle/0035_automation_implementation_runs.sql` and `drizzle/0036_runner_pr_watch_repair_graph.sql` remain in the journal for reproducibility. No production tables, queues, or PGMQ objects were dropped.
- **Future DB cleanup:** Obsolete `automation.*` tables/queues are candidates for a separate, explicitly authorized migration. Do not mutate production without approval.
- **Generic surfaces retained:** `/api/agent`, MCP/OAuth (`apps/web/src/lib/mcp`), and integration APIs are independent and remain.

## Current architecture

```
Web + Mobile + API
        ↓
Shared domain/application/contracts
        ↓
Data access
        ↓
Supabase/Postgres

plus MCP / external integrations
```

No active governance, CI, or documentation implies `Linear → PGMQ → Runner → Hermes` is supported.

