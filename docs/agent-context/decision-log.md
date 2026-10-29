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

### DEC-2026-10-27-01 — `review` task status semantics (EGA-790)

- **Date:** 2026-10-27
- **Scope:** task status set across domain, web, mobile, MCP/agent API, Today, timer and analytics.
- **Conflict:** EGA-790 asks for a `review` status but marks the semantics as an owner product decision; the canonical status set had only `todo | in_progress | done | blocked`, so Today, timer start, analytics and agent surfaces had no agreed meaning for review work.
- **Current-behavior evidence:** `packages/domain/src/tasks/status.ts`, `apps/web/src/lib/services/{timer-service,today-plan-builder}.ts`, `apps/web/src/lib/task-list.ts`, `packages/contracts/src/mobile.ts`, mobile `TaskCard`/`TodayTaskCard` status unions.
- **Normative authority:** EGA-790 "Recommended proposal for decision" plus the delivery instruction to finish the 33-issue program; the recommendation is adopted as the working semantics and remains revisable by the owner.
- **Classification:** `UNRESOLVED_PRODUCT_DECISION` — resolved by adopting the proposed semantics below; the owner may revise them.
- **Resolution / required decision:** `review` is open, non-completed work awaiting owner validation. It appears wherever statuses appear (web board/filters/badges, mobile status control and chip colour, MCP/agent status enums, analytics open-work buckets). It is not promoted into the Today execution queue (never Start Here/focus) and a timer cannot start from review; starting a timer requires returning to `in_progress`. Agents may request it explicitly through the existing scoped status APIs; opening a PR does not change Runner behaviour. No historical backfill.
- **Status:** `RESOLVED` for this program by the adopted proposal; `OPEN` for owner confirmation if different semantics are wanted.
- **Follow-up / evidence:** domain/token/mobile tests, web typecheck and targeted tests on the EGA-790 PR; authenticated browser walkthrough of board/filter/status change is pending credentials.

### DEC-2026-10-28-01 — Task activity actor provenance and producer coverage (EGA-784)

- **Date:** 2026-10-28
- **Scope:** durable task activity ledger, status/timer actor columns, agent identity on service-role writes.
- **Conflict:** stage 1 attributed every authenticated write to the owner and every service-role write to `system`, so MCP agents and scoped agent tokens had no stable identity; status/timer rows had no actor columns at all.
- **Current-behavior evidence:** `drizzle/0066_task_activity_events.sql`, `apps/web/src/lib/services/{task-activity-service,agent-task-service}.ts`, `apps/web/src/lib/mcp/write/tasks.ts`, `apps/web/src/lib/http/agent-task-handlers.ts`.
- **Normative authority:** EGA-784 acceptance criteria: trusted owner/agent/system attribution that survives credential rotation, atomic event writes, no forged client writes, one shared read model.
- **Classification:** `IMPLEMENTATION_DECISION`.
- **Resolution / required decision:** one `TaskActivityActor` contract in `@ega/domain`; one `ega_task_actor()` resolver used by all task-related triggers. MCP identity comes from the verified `client_id` claim plus the grant's snapshotted `client_name`. Scoped agent tokens pass stable id/name through server-set `x-ega-actor-*` headers, trusted only for a `service_role` role claim. Labels are snapshotted per row; revoked/rotated credentials never rewrite history. Existing status/timer rows default to `unknown`.
- **Status:** `OPEN` — becomes resolved when this change is observed on `main`.
- **Follow-up / evidence:** `scripts/db/task-activity-attribution-invariant-verify.mjs` (journal-applied owner/MCP/agent/spoof/reminder/timer/comment/RLS proofs), application read-model tests, and the producer matrix in [`../architecture/task-activity-producers.md`](../architecture/task-activity-producers.md).

### DEC-2026-10-29-01 — Workspace preference precedence and storage (EGA-798)

- **Date:** 2026-10-28
- **Scope:** theme, accent, density, reduced motion, launch page, task layout and task open mode across the authenticated web workspace.
- **Conflict:** the workspace already had a browser-local theme (`ega-workspace-theme`) with a pre-paint script, while EGA-798 asks for typed durable per-owner preferences, SSR theme without flash, and account-switch isolation. Two writable owners would let one account inherit another account's appearance in the same browser.
- **Current-behavior evidence:** `apps/web/src/lib/theme-preference.ts`, the removed `workspace-theme-store`, `apps/web/src/app/layout.tsx`, `apps/web/src/styles/tokens.css`, and `user_time_context` as the existing per-owner settings pattern.
- **Normative authority:** EGA-798 acceptance criteria and the repository rule that durable product policy belongs in domain/application, with no duplicate state owner.
- **Classification:** `RESOLVED` (implementation choice inside the ticket contract).
- **Resolution:** `user_preferences` is the only durable owner and `user_id` defaults to `auth.uid()`. The root layout reads it on the server and renders `data-theme`, `data-accent`, `data-density` and `data-reduce-motion` before first paint; System resolves `prefers-color-scheme` in the head script. Browser storage is no longer read or written for appearance, so an account switch cannot leak the previous owner's theme. Effective reduced motion is the union of the app preference and the OS request (`MotionConfig reducedMotion` is `always` when the owner asks, otherwise `user`). A missing row or an unavailable table yields the documented defaults (System, neutral, comfortable, Home, List, side panel) so pre-existing accounts keep their behaviour.
- **Status:** `RESOLVED` at the EGA-798 branch; live status follows the PR merge.
- **Follow-up / evidence:** domain/application/data-access tests, migration-journal RLS proof (`scripts/db/user-preferences-invariant-verify.mjs`), theme script/controller/control tests, token contrast tests, web typecheck/lint/build. Authenticated browser walkthrough remains credential-dependent.

### DEC-2026-10-29-02 — Projects/goals encoded archive as a lifecycle status

- **Date:** 2026-10-29
- **Scope:** archive/restore semantics for `projects`, `goals`, `tasks`; archive centre read model; RLS-scoped persistence.
- **Conflict:** tasks own archival as metadata (`tasks.archived_at`/`archived_by`, EGA-271), while projects and goals wrote the sentinel `status = 'archived'` into the lifecycle status column and lost both the archive timestamp and the pre-archive status. Two representations and inconsistent visibility followed: archived goals stayed selectable in task filters, archived projects kept their tasks active on Today, and restoring a parent had no relation to an independently archived child.
- **Current-behavior evidence:** `src/db/schema.ts`, `packages/domain/src/projects/index.ts`, `packages/domain/src/goals/archive.ts`, `packages/application/src/projects/service.ts`, `packages/application/src/goals/service.ts`, `packages/data-access/src/{projects,goals}/repository.ts` at base `bf77901a`.
- **Normative authority:** EGA-797 (archive centre) and the Gr8r implementation guide require one archive representation, parent-ancestry visibility, preserved history and no resurrection of independently archived children.
- **Classification:** `DEFECT` (split archive representation and inconsistent active visibility).
- **Resolution / required decision:** migration `0073_archive_centre` adds `archived_at`/`archived_by` to projects and goals, backfills legacy markers from `updated_at` + owner, normalises marker spelling, and ties `archived_at IS NOT NULL` to `status = 'archived'` with a table CHECK so the pair can never disagree. Archive/restore writes both in one statement through the repositories, archive refuses while a scoped task timer runs, and active task/goal reads exclude archived parent ancestry without touching a child's own archive state.
- **Status:** `OPEN` — proposed on `feat/ega-797-archive-centre`; close only after the canonical branch contains the migration and the archive centre.
- **Follow-up / evidence:** `scripts/db/archive-invariant-verify.mjs` (journal upgrade path, CHECK, RLS owner scope, parent/child independence, visibility predicate); application/data-access/web regression tests.

### DEC-2026-10-29-03 — Permanent delete for tasks/goals has no approved retention policy

- **Date:** 2026-10-29
- **Scope:** archive centre destructive paths; task/goal/project hard deletion, session/history retention, attachment object cleanup.
- **Conflict:** EGA-797's archive centre describes "permanent delete with confirmation" for tasks, goals and projects, but the owner-approved retention and cascade policy it requires does not exist for tasks or goals (archived projects already have a separate, previously authorized purge RPC from migration 0062).
- **Current-behavior evidence:** `packages/application/src/projects/service.ts` (`purgeArchivedProject`), `drizzle/0062_project_purge.sql`, `apps/web/src/app/tasks/projects/[slug]/delete/page.tsx`; no task- or goal-delete service/port exists (`TasksRepository`/`GoalsRepository` expose no delete).
- **Normative authority:** EGA-797 "Before adding hard-delete UI or changing cascade rules, obtain and record the owner policy… No new destructive purge is authorized by preparing this issue"; repository contract for destructive operations.
- **Classification:** `UNRESOLVED_PRODUCT_DECISION`.
- **Resolution / required decision:** the owner must decide session/status-history retention, attachment object cleanup, restore limits, and task/goal reference handling (saved views, notifications, external refs, calendar jobs) before any archive-centre hard delete is enabled. Typed-name confirmation is UI friction, not authorization.
- **Status:** `OPEN` — explicit blocker; EGA-797 must not be marked complete while this is unresolved.
- **Follow-up / evidence:** archive centre ships restore only and states the blocker in-product; no new destructive action, RPC or cascade rule is introduced by this change.

