# Agent Decision Log

This log persists material **current-behavior vs normative-authority conflicts** so independent agent sessions do not repeatedly invent different classifications. It is not a product specification, ADR replacement, backlog, or override mechanism.

## Rules

- Search this file before classifying a material conflict already encountered by another session.
- Record only conflicts that affect implementation/governance/architecture decisions, not ordinary coding notes.
- Classification is exactly `DEFECT` or `UNRESOLVED_PRODUCT_DECISION`.
- A log entry may cite current evidence and higher authority; it may not manufacture authority.
- `OPEN` means the conflict is still present on the canonical branch or still needs a product decision.
- `RESOLVED` requires evidence that the canonical repository/product authority now contains the resolution, not merely that a task branch proposes it.
- `SUPERSEDED` requires a link/reference to the newer entry/ADR/spec.
- Durable architecture decisions should be promoted to `docs/architecture/decisions/`; keep the log entry as the audit trail.
- Correct factual mistakes in place, but do not erase historical classifications merely because the code later changed.

## Entry template

```text
### DEC-YYYY-MM-DD-NN — Short title
- Date:
- Scope:
- Conflict:
- Current-behavior evidence:
- Normative authority:
- Classification: DEFECT | UNRESOLVED_PRODUCT_DECISION
- Resolution / required decision:
- Status: OPEN | RESOLVED | SUPERSEDED
- Follow-up / evidence:
```

## Entries

### DEC-2026-08-25-01 — Living docs still described the pre-monorepo root layout

- **Date:** 2026-08-25
- **Scope:** repository navigation, product architecture, agent context.
- **Conflict:** `AGENTS.md`, `README.md`, and `ARCHITECTURE.md` still directed agents toward root `src/app` / `src/lib` even though the current repository has `apps/web`, `apps/server`, `apps/mobile`, five `packages/*` workspaces, and root `src/` retained primarily for database authority.
- **Current-behavior evidence:** root `package.json` workspaces/scripts; `apps/*`; `packages/*`; `scripts/architecture/check-boundaries.mjs`; current Hono/server routes; root `src/db`.
- **Normative authority:** accepted ADR 001 and current platform boundary enforcement require the workspace topology and one database authority to be understood correctly.
- **Classification:** `DEFECT` (documentation/navigation drift).
- **Resolution / required decision:** update living root/agent architecture docs, validation navigation, and authority map around the implemented monorepo without rewriting historical migration evidence as current truth.
- **Status:** `OPEN` — corrective change proposed on `docs/agent-architecture-context-refresh`; close only after the canonical branch contains the fix.
- **Follow-up / evidence:** validate agent-context links/navigation and executable architecture boundaries; review/merge through normal human PR policy.

### DEC-2026-08-25-02 — Hermes preflight required only the legacy external-dir path

- **Date:** 2026-08-25
- **Scope:** Hermes repository skill discovery.
- **Conflict:** repository preflight/fallback guidance treated `skills.external_dirs` as mandatory and same-name user-local skills as unconditional shadow failures. Current Hermes documentation supports trusted project-local discovery from `.hermes/skills` and `.agents/skills`, with project skills taking precedence; `external_dirs` remains a fallback.
- **Current-behavior evidence:** `.agents/skills`, `.hermes/skills`, `scripts/agent/preflight-hermes-skills.mjs`, `HERMES_MASTER_PROMPT.md`.
- **Normative authority:** repository policy requires verifiable repository skill provenance without silently editing user-global config; current Hermes project-local trust/discovery semantics satisfy that goal more directly.
- **Classification:** `DEFECT` (tooling discovery contract drift).
- **Resolution / required decision:** prefer explicit trusted project-local discovery; preserve read-only `external_dirs` compatibility fallback; never auto-trust or mutate global Hermes config.
- **Status:** `OPEN` — corrective change proposed on `docs/agent-architecture-context-refresh`; close only after canonical merge and real-profile discovery verification.
- **Follow-up / evidence:** run `npm run preflight:hermes-skills` under the actual Runner service user/profile and record `DISCOVERY VERIFIED` or the exact blocker.

### DEC-2026-09-04-01 — Agent authority, scope, and merge instructions conflict

- **Date:** 2026-09-04
- **Scope:** root/scoped agent contracts and shared validation/quality guidance.
- **Conflict:** at `f9d248470fc9c80c27bb240a9638b976d43e1bf8`, root guidance ranks source ahead of runtime while product-authority ranks runtime first; root requires all scope files while the index selects applicable scopes; authorized merges coexist with an unconditional remain-unmerged sentence. Root test aliases verify web only without saying so in the root command list.
- **Current-behavior evidence:** root `AGENTS.md`, `package.json`, `product-authority.md`, `index.md`, and `testing-and-validation.md` at that revision.
- **Normative authority:** user-approved agent-contract analysis and explicit instruction to implement the improvement and merge it; existing product, security, and protection invariants remain in force.
- **Classification:** `DEFECT` (instruction inconsistency and incomplete evidence routing).
- **Resolution / required decision:** unify evidence by claim/revision/environment; select applicable scopes; clarify existing authorization and explicit merge gates; route checks to affected workspaces and consumers. Add proportional investigation, recovery, review, and completion guidance without changing application/CI behavior.
- **Status:** `OPEN` — proposed on `docs/agent-contract-quality-20260904`; this becomes `RESOLVED` only when the corrective change is observed on the canonical branch. Reconcile status at the next decision-log maintenance after that observation.
- **Follow-up / evidence:** validate instruction links, commands, discovery budget, applicable architecture checks, independent semantic review, and exact-head CI. Writing guidance does not prove installed harness discovery or production behavior.

### DEC-2026-10-29-01 — Projects/goals encoded archive as a lifecycle status

- **Date:** 2026-10-29
- **Scope:** archive/restore semantics for `projects`, `goals`, `tasks`; archive centre read model; RLS-scoped persistence.
- **Conflict:** tasks own archival as metadata (`tasks.archived_at`/`archived_by`, EGA-271), while projects and goals wrote the sentinel `status = 'archived'` into the lifecycle status column and lost both the archive timestamp and the pre-archive status. Two representations and inconsistent visibility followed: archived goals stayed selectable in task filters, archived projects kept their tasks active on Today, and restoring a parent had no relation to an independently archived child.
- **Current-behavior evidence:** `src/db/schema.ts`, `packages/domain/src/projects/index.ts`, `packages/domain/src/goals/archive.ts`, `packages/application/src/projects/service.ts`, `packages/application/src/goals/service.ts`, `packages/data-access/src/{projects,goals}/repository.ts` at base `bf77901a`.
- **Normative authority:** EGA-797 (archive centre) and the Gr8r implementation guide require one archive representation, parent-ancestry visibility, preserved history and no resurrection of independently archived children.
- **Classification:** `DEFECT` (split archive representation and inconsistent active visibility).
- **Resolution / required decision:** migration `0064_archive_centre` adds `archived_at`/`archived_by` to projects and goals, backfills legacy markers from `updated_at` + owner, normalises marker spelling, and ties `archived_at IS NOT NULL` to `status = 'archived'` with a table CHECK so the pair can never disagree. Archive/restore writes both in one statement through the repositories, archive refuses while a scoped task timer runs, and active task/goal reads exclude archived parent ancestry without touching a child's own archive state.
- **Status:** `OPEN` — proposed on `feat/ega-797-archive-centre`; close only after the canonical branch contains the migration and the archive centre.
- **Follow-up / evidence:** `scripts/db/archive-invariant-verify.mjs` (journal upgrade path, CHECK, RLS owner scope, parent/child independence, visibility predicate); application/data-access/web regression tests.

### DEC-2026-10-29-02 — Permanent delete for tasks/goals has no approved retention policy

- **Date:** 2026-10-29
- **Scope:** archive centre destructive paths; task/goal/project hard deletion, session/history retention, attachment object cleanup.
- **Conflict:** EGA-797's archive centre describes "permanent delete with confirmation" for tasks, goals and projects, but the owner-approved retention and cascade policy it requires does not exist for tasks or goals (archived projects already have a separate, previously authorized purge RPC from migration 0062).
- **Current-behavior evidence:** `packages/application/src/projects/service.ts` (`purgeArchivedProject`), `drizzle/0062_project_purge.sql`, `apps/web/src/app/tasks/projects/[slug]/delete/page.tsx`; no task- or goal-delete service/port exists (`TasksRepository`/`GoalsRepository` expose no delete).
- **Normative authority:** EGA-797 "Before adding hard-delete UI or changing cascade rules, obtain and record the owner policy… No new destructive purge is authorized by preparing this issue"; repository contract for destructive operations.
- **Classification:** `UNRESOLVED_PRODUCT_DECISION`.
- **Resolution / required decision:** the owner must decide session/status-history retention, attachment object cleanup, restore limits, and task/goal reference handling (saved views, notifications, external refs, calendar jobs) before any archive-centre hard delete is enabled. Typed-name confirmation is UI friction, not authorization.
- **Status:** `OPEN` — explicit blocker; EGA-797 must not be marked complete while this is unresolved.
- **Follow-up / evidence:** archive centre ships restore only and states the blocker in-product; no new destructive action, RPC or cascade rule is introduced by this change.
