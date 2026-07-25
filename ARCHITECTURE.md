# EGA House Architecture

This document separates repository-proven behavior from target architecture. Status labels are `CURRENT`, `PARTIAL`, `SCAFFOLDED`, `EXTERNAL_UNVERIFIED`, `ABSENT`, and `DEPRECATED`.

## System map

| Component | Status | Responsibility | Authority |
|---|---|---|---|
| Next.js web app | CURRENT | Tasks, goals, timer, review, agent APIs | `src/app`, `src/lib`, `src/db/schema.ts` |
| Expo mobile app | CURRENT/PARTIAL | Mobile task/today experiences | `apps/mobile` |
| Supabase/Postgres | CURRENT | Durable product data | Versioned schema/migrations plus deployed Supabase |
| Agent task-control API | CURRENT | Scoped external task/project/goal access | `src/app/api/agent`, `src/lib/services/agent-task-service.ts` |
| Automation schema | PARTIAL/EXTERNAL_UNVERIFIED | Run, event, artifact, and webhook records | Deployed `automation.*`; only additive compatibility migration is versioned |
| PGMQ | PARTIAL | Pending implementation work | `hermes_implementation_jobs` queue |
| EGA Runner | PARTIAL | Claim, lease, worktree, Hermes, Git, push, PR attempt | `scripts/ega-runner/src` |
| Hermes CLI | PARTIAL | Generate and commit scoped code in a Runner worktree | Invoked by `hermes-executor.ts` |
| GitHub sync | PARTIAL | Push, commit status, PR attempt | `github.ts`; terminal proof is incomplete |
| Vercel sync | SCAFFOLDED | Verify deployment by SHA | Adapter exists but is not called by Runner completion |
| Slack | CURRENT reporting | Start/failure/completion and PR readiness notifications | Never workflow truth |
| Reconciliation | ABSENT | Repair partial side effects and stale attempts | No canonical engine |

## Product architecture

The primary shipped product is the productivity platform:

```text
Browser / Expo client
→ Next.js route handlers and server actions
→ service layer
→ Supabase/Postgres
```

The web schema in `src/db/schema.ts` covers projects, goals, tasks, calendar synchronization, agent integration audit records, external task references, and related product entities. The mobile app consumes dedicated mobile API contracts.

## Autonomous delivery vertical slice

The repository target is:

```text
Authorized Linear issue
→ authenticated webhook
→ durable automation run
→ PGMQ message
→ Runner claim + lease
→ isolated attempt/worktree
→ Hermes execution
→ independent Git verification
→ branch push
→ GitHub PR
→ required checks
→ Vercel preview
→ human review/merge
→ deployment synchronization
→ durable completion evidence
→ Slack reporting
→ reconciliation
```

### Current evidence

- CURRENT/PARTIAL: queue read, atomic claim, DB lease, queue visibility renewal, event persistence.
- CURRENT/PARTIAL: deterministic branch/path calculation, worktree creation, Hermes process invocation, result-file parsing, changed-path and commit verification.
- CURRENT/PARTIAL: branch push, pushed-SHA comparison, commit status, PR creation attempt.
- SCAFFOLDED: check polling and Vercel verification functions.
- EXTERNAL_UNVERIFIED: signed webhook and complete automation schema because the repository only contains an additive compatibility migration.
- ABSENT: durable attempt aggregate separate from run rows, automatic stale-attempt recovery, reconciliation, and proven production deployment synchronization.

## Dependency and authority direction

```text
Linear / webhook producer
        ↓
automation.implementation_runs + events/artifacts ← PGMQ pending work
        ↓
EGA Runner (temporary owner through claimed_by + lease)
        ↓
worktree → Hermes → Git verification → GitHub
                                 ↓
                         Vercel / human merge
                                 ↓
                     durable synchronization (incomplete)

Slack receives projections; it does not own state.
```

The Runner may update an owned run, but every terminal/external action must remain conditional on current ownership and durable evidence. Existing code does not yet enforce every part of this rule.

## Known architecture contradictions

1. `scripts/ega-runner/README.md` and historical proof notes overstate check/Vercel completion.
2. `main.ts` can mark a run completed even when PR creation returns no PR.
3. Check waiting and Vercel verification are imported/scaffolded but not part of the terminal path.
4. Existing worktree creation force-resets branches and adds worktrees with `--force`, contradicting stale-attempt isolation.
5. Linear project authorization is not proven because the current adapter hardcodes the project check.
6. The Hermes prompt asks Hermes to create a PR while the Runner also attempts PR creation.
7. No reconciliation service repairs partial GitHub, Vercel, Linear, or Slack effects.

Treat these as defects/limitations, not supported behavior.

## Deeper documents

- [Product authority](docs/agent-context/product-authority.md)
- [Delivery lifecycle](docs/architecture/delivery-lifecycle.md)
- [Queue and leases](docs/architecture/queue-and-leases.md)
- [Runner and worktrees](docs/architecture/runner-and-worktrees.md)
- [Hermes execution](docs/architecture/hermes-execution.md)
- [Testing and validation](docs/agent-context/testing-and-validation.md)
