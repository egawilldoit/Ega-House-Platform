# EGA House Architecture

This document describes repository-supported current behavior and known implementation gaps. It does not override the normative product authority defined in [`docs/agent-context/product-authority.md`](docs/agent-context/product-authority.md).

Status labels are `CURRENT`, `PARTIAL`, `SCAFFOLDED`, `EXTERNAL_UNVERIFIED`, `ABSENT`, and `DEPRECATED`.

## Reading architecture evidence

Use the **current-behavior evidence** hierarchy to determine what is implemented. Use the separate **normative product-authority** hierarchy to determine what should be implemented. When they disagree, record a defect or unresolved product decision instead of converting either side into the other.

## System map

| Component | Status | Responsibility | Current-behavior evidence |
|---|---|---|---|
| Next.js web app | CURRENT | Tasks, goals, timer, review, agent APIs | `src/app`, `src/lib`, `src/db/schema.ts` |
| Expo mobile app | CURRENT/PARTIAL | Mobile task/today experiences | `apps/mobile` |
| Supabase/Postgres | CURRENT | Durable product data | Versioned schema/migrations plus deployed Supabase evidence when available |
| Agent task-control API | CURRENT | Scoped external task/project/goal access | `src/app/api/agent`, `src/lib/services/agent-task-service.ts` |
| Automation schema | PARTIAL/EXTERNAL_UNVERIFIED | Run, event, artifact, webhook, PR-monitor, and repair records | `drizzle/0035_*`, `drizzle/0036_*`; deployed state still requires proof |
| PGMQ | PARTIAL | Pending implementation work | `hermes_implementation_jobs` and Runner queue adapter |
| EGA Runner | CURRENT/PARTIAL | Claim, lease, worktree, Hermes, validation, push, PR, monitor, repair | `scripts/ega-runner/src` |
| Hermes CLI | PARTIAL | Generate and commit scoped code in Runner-owned worktrees | `hermes-executor.ts`, `repair-loop.ts`; deployed skill discovery remains environment-dependent |
| GitHub sync | CURRENT/PARTIAL | Verified PR identity, checks, reviews, merge readiness | `github.ts`, `pr-monitor.ts` |
| Vercel sync | PARTIAL | Optional exact-SHA preview gate | `vercel.ts`, `pr-monitor.ts` |
| Slack | CURRENT reporting | Threaded human-readable projections | `notify.ts`; never workflow truth |
| Reconciliation | ABSENT | Repair partial side effects and stale attempts | No canonical reconciliation engine |

## Product architecture

```text
Browser / Expo client
→ Next.js route handlers and server actions
→ service layer
→ Supabase/Postgres
```

## Autonomous delivery graph

```text
ChatGPT planning
→ authorized Linear issue
→ authenticated webhook
→ durable automation run + PGMQ
→ Runner claim + lease
→ isolated worktree
→ Hermes implementation
→ independent scope/commit/command validation
→ verified push and PR
→ GitHub check/review monitor
→ bounded Hermes repair ↺
→ preview gate when configured
→ human approval and merge
→ deployment synchronization
→ reconciliation
```

### Current evidence classification

- CURRENT/PARTIAL: queue read, atomic claim, leases, visibility renewal, events.
- CURRENT/PARTIAL: Linear context, deterministic scope/context, worktree, Hermes execution, result parsing.
- CURRENT/PARTIAL: Runner-owned scope, commit, command, push, remote-SHA, and strict PR verification.
- CURRENT/PARTIAL: polling-based PR check/review observation, bounded repair attempts, and optional head-SHA-pinned auto-merge requests.
- PARTIAL: exact-SHA Vercel preview verification is integrated as an optional gate, not yet live-proven.
- EXTERNAL_UNVERIFIED: webhook ingress and deployed automation schema.
- EXTERNAL_UNVERIFIED: Hermes repository-skill visibility under the VM service profile.
- ABSENT: automatic stale-attempt creation, canonical cross-system reconciliation, and proven production deployment synchronization.

## State and authority direction

```text
Linear / webhook producer
        ↓
automation.implementation_runs + events ← PGMQ implementation messages
        ↓
EGA Runner temporary execution ownership
        ↓
worktree → Hermes → Runner verification → GitHub PR
                                      ↓
                         checks / reviews / Vercel
                                      ↓
                         human merge by default
                                      ↓
                    deployment sync (incomplete)

Slack receives projections; it does not own state.
```

## Known implementation conflicts and limits

1. Linear project authorization is not fully proven by deployed evidence.
2. Hermes repository skill discovery is not proven until preflight succeeds as the VM service user.
3. The initial Hermes prompt still lacks the complete child/parent issue descriptions.
4. Automated repair depends on the persisted isolated worktree remaining available.
5. Lease-loss detection does not yet actively interrupt every in-flight subprocess and side effect.
6. Post-push repair failures are fenced to `needs_human`, but no general reconciliation engine repairs all partial GitHub, Vercel, Linear, or Slack effects.
7. Repository implementation and focused local checks do not equal live VM E2E proof.

## Deeper documents

- [Product authority](docs/agent-context/product-authority.md)
- [Delivery lifecycle](docs/architecture/delivery-lifecycle.md)
- [Queue and leases](docs/architecture/queue-and-leases.md)
- [Runner and worktrees](docs/architecture/runner-and-worktrees.md)
- [Hermes execution](docs/architecture/hermes-execution.md)
- [Testing and validation](docs/agent-context/testing-and-validation.md)
