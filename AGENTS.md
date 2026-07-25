# EGA House Agent Guide

## Product identity

EGA House is a multi-surface productivity platform with a Next.js web application, an Expo mobile application, an agent task-control API, and an autonomous-delivery Runner under active development.

Do not describe the full Linear → Runner → PR → preview lifecycle as production-complete. The repository proves a meaningful Runner vertical slice, but authorization, stale-attempt isolation, PR/check/preview completion, and reconciliation still contain gaps documented in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Repository authority

Use this precedence when sources disagree:

1. Current executable code and migrations.
2. Tests that exercise the current path.
3. [`docs/agent-context/product-authority.md`](docs/agent-context/product-authority.md).
4. [`ARCHITECTURE.md`](ARCHITECTURE.md) and current architecture documents.
5. Runbooks and feature documentation.
6. Historical plans, proof notes, prompts, and chat transcripts.

Never promote documentation-only or external production behavior to `IMPLEMENTED` without repository evidence.

## Current system status

| Area | Status | Canonical path |
|---|---|---|
| Web productivity product | Implemented | `src/app`, `src/lib`, `src/db/schema.ts` |
| Mobile client | Implemented/partial by feature | `apps/mobile` |
| Agent task-control API | Implemented | `src/app/api/agent`, `src/lib/services/agent-task-service.ts` |
| Queue/claim/lease Runner | Partially implemented | `scripts/ega-runner/src` |
| Worktree/Hermes/Git verification | Partially implemented | `scripts/ega-runner/src/{worktree,hermes-executor,result}.ts` |
| PR synchronization | Partially implemented | `scripts/ega-runner/src/github.ts` |
| Check and Vercel completion | Scaffolded, not wired into terminal success | `scripts/ega-runner/src/{github,vercel}.ts` |
| Reconciliation and stale-attempt recovery | Absent | No canonical implementation |

## Non-negotiable boundaries

- Never implement directly on `main` or another protected branch.
- Keep one authorized issue or explicitly bounded request as the unit of work. Do not select the next issue autonomously.
- Do not create a second state authority. Web product state belongs to its service/database path; automation run state belongs to `automation.implementation_runs` and its event/artifact records.
- Runner queue consumption must use the canonical `pgmq.read()` → visibility/lease renewal → durable terminal transition → `pgmq.archive()` pattern. Never introduce `pgmq.pop()`.
- Do not archive queue work on ambiguity, an exception, or ownership loss.
- Do not continue external side effects after lease ownership is uncertain. Current heartbeat cancellation is incomplete; treat this as a defect, not permission.
- Never trust Hermes prose, exit code, or result JSON as implementation proof. Verify actual changed paths, Git diff, commit ancestry, branch, pushed SHA, and required validations independently.
- Do not treat a nullable/missing PR, pending checks, or absent preview as completed delivery. Current Runner terminal semantics are incomplete.
- Do not reuse or force-reset an unverified stale branch/worktree. Current `--force` behavior is a known safety gap.
- Slack is reporting only. Slack messages and READY markers are not workflow truth.
- Runner-created PRs require human review and merge. Do not enable broad automatic merge or weaken guardian gates without explicit authorization.
- Never expose or edit secrets, `.env` values, credentials, production tokens, or deployment settings without explicit authorization.

## Repository map

- [`ARCHITECTURE.md`](ARCHITECTURE.md): verified system map and status classification.
- [`docs/agent-context/index.md`](docs/agent-context/index.md): agent-context entry point.
- [`docs/agent-context/product-authority.md`](docs/agent-context/product-authority.md): ownership and forbidden bypasses.
- [`docs/agent-context/testing-and-validation.md`](docs/agent-context/testing-and-validation.md): real validation commands by change type.
- [`docs/architecture/delivery-lifecycle.md`](docs/architecture/delivery-lifecycle.md): current lifecycle and terminal gaps.
- [`docs/architecture/queue-and-leases.md`](docs/architecture/queue-and-leases.md): queue, claim, lease, and archive contract.
- [`docs/architecture/runner-and-worktrees.md`](docs/architecture/runner-and-worktrees.md): Runner and attempt isolation.
- [`docs/architecture/hermes-execution.md`](docs/architecture/hermes-execution.md): Hermes invocation and proof boundaries.
- `src/app`, `src/lib`, `src/db`: web product and API.
- `apps/mobile`: Expo client and mobile validation.
- `scripts/ega-runner`: autonomous delivery Runner.
- `.github/workflows/slack-pr-ready.yml`: PR readiness reporting; it does not merge.
- `scripts/hermes-auto-merge-guardian.mjs`: separate controlled docs-only guardian, not canonical Runner completion.

## Default working method

1. Read the assigned issue/request and extract explicit scope, acceptance criteria, authorized paths, and required evidence.
2. Read this file and the closest subsystem documentation. Use a focused skill when its trigger matches.
3. Trace the current implementation and tests before editing. Identify the canonical service/module rather than adding a parallel path.
4. Record what is implemented, partial, scaffolded, absent, or contradicted by code.
5. Make the smallest coherent patch that preserves unrelated behavior and existing contracts.
6. Add or update tests at the closest reliable public seam. Do not replace runtime validation with mocked self-claims.
7. Run the minimum validation matrix, then broader checks when the changed surface requires them.
8. Inspect the final diff for scope, generated files, secrets, duplicate authority, and stale documentation.
9. Report commands, results, runtime evidence, and limitations honestly. Use the verdict vocabulary from the final-verification skill.

## Approval boundaries

Allowed without additional approval:

- Read/search repository files and Git history.
- Inspect local Git state, logs, generated evidence, and local database state read-only.
- Edit in-scope repository files on a task branch.
- Run non-destructive tests, lint, type checks, builds, and local validation scripts.
- Create task-local temporary evidence that is not committed.

Require explicit approval:

- Merge, deploy, force-push, rebase shared branches, or alter protected-branch policy.
- Delete user work, force-clean worktrees, reset branches, or perform destructive database operations.
- Modify secrets, production credentials, external production state, authorization boundaries, or broad data migrations.
- Add production dependencies or enable automatic merge behavior.

## Validation navigation

Run `npm run validate:agent-context` for agent-context changes. Select all other commands from [`docs/agent-context/testing-and-validation.md`](docs/agent-context/testing-and-validation.md). Do not repeat stale test counts as a permanent baseline; report the exact result from the current commit.

## Repository skills

- `code-truth-audit`: multi-pass repository or feature truth audit before architecture/context changes.
- `issue-implementation`: implement one authorized issue through the canonical path.
- `delivery-run-diagnostics`: reconstruct one delivery/run/attempt chronologically.
- `database-evidence`: bounded read-only automation-state evidence collection.
- `code-review`: review for EGA House state, queue, lease, worktree, authorization, and evidence risks.
- `final-verification`: produce an evidence-based completion verdict.
- Existing focused skills such as `tdd`, `graphify`, and `improve-codebase-architecture` remain optional helpers; they cannot weaken the boundaries above.
