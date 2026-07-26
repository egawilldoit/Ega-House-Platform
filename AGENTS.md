# EGA House Agent Guide

## Product identity

EGA House is a multi-surface productivity platform with a Next.js web application, an Expo mobile application, an agent task-control API, and a partially implemented autonomous-delivery Runner.

Detailed component status and current Runner gaps live in [`ARCHITECTURE.md`](ARCHITECTURE.md). Do not duplicate that fast-changing inventory here.

## Evidence and authority

Use two distinct questions:

- **What does the repository currently do?** Use the current-behavior evidence hierarchy in [`docs/agent-context/product-authority.md`](docs/agent-context/product-authority.md).
- **What behavior is required?** Use the normative product-authority hierarchy in the same document.

When implementation conflicts with normative authority, classify the difference as a defect or unresolved product decision. Do not silently normalize current code and do not silently rewrite product policy.

## Universal safety invariants

- Never implement directly on `main` or another protected branch.
- Keep one authorized issue or explicitly bounded request as the unit of work. Do not select the next issue autonomously.
- Do not create a second state authority. Use the canonical product service/database path or the canonical automation run/event/artifact path.
- Runner queue consumption must preserve the `pgmq.read()` → visibility/lease renewal → durable classification → `pgmq.archive()` direction. Never introduce executable `pgmq.pop()` usage.
- Do not archive queue work on ambiguity, exception, or ownership loss.
- Do not perform new external side effects after lease ownership becomes uncertain.
- Never trust Hermes prose, exit code, or result JSON as implementation proof. Verify the actual filesystem, Git, validations, pushed SHA, PR, checks, and preview required by the contract.
- Do not reuse or force-reset an unverified stale branch/worktree.
- Slack is reporting only, never workflow truth.
- Runner-created PRs require human review and merge unless a separate, explicit authorization changes that policy.
- Never expose or edit secrets, `.env` values, credentials, production tokens, or deployment settings without explicit authorization.

## Scope and approval

Allowed without additional approval:

- Read/search repository files and Git history.
- Inspect local Git state, logs, generated evidence, and approved read-only database evidence.
- Edit in-scope files on the assigned task branch.
- Run non-destructive tests, lint, type checks, builds, and repository validation scripts.

Require explicit approval:

- Merge, deploy, force-push, rebase shared branches, or alter protected-branch policy.
- Delete user work, force-clean worktrees, reset branches, or run destructive database operations.
- Modify secrets, production credentials, external production state, authorization boundaries, broad migrations, or automatic-merge behavior.

## Default working method

1. Read the assigned issue/request and extract acceptance criteria, scope, authorized paths, and required evidence.
2. Read this file and the closest relevant architecture document.
3. Trace current implementation and tests before editing; identify the canonical owner instead of adding a parallel path.
4. Compare current behavior with normative authority and record defects or unresolved decisions explicitly.
5. Make the smallest coherent patch that preserves unrelated behavior.
6. Add or update tests at the closest reliable public seam.
7. Run the minimum validation matrix, then broader checks required by the changed surface.
8. Inspect the final diff for scope, generated files, secrets, duplicated authority, and stale documentation.
9. Report exact commands, exit codes, observed evidence, unavailable checks, and one evidence-based verdict.

## Repository navigation

- [`ARCHITECTURE.md`](ARCHITECTURE.md): current system map and implementation status.
- [`docs/agent-context/index.md`](docs/agent-context/index.md): agent-context entry point.
- [`docs/agent-context/product-authority.md`](docs/agent-context/product-authority.md): current-behavior evidence and normative authority.
- [`docs/agent-context/testing-and-validation.md`](docs/agent-context/testing-and-validation.md): command matrix and evidence labels.
- [`docs/agent-context/skill-routing-evaluation.md`](docs/agent-context/skill-routing-evaluation.md): expected skill-routing examples.
- [`docs/architecture/`](docs/architecture/): delivery, queue/lease, worktree, and Hermes contracts.
- `src/app`, `src/lib`, `src/db`: web product and APIs.
- `apps/mobile`: Expo application.
- `scripts/ega-runner`: autonomous-delivery Runner.

## Validation navigation

For agent-context changes run `npm run validate:agent-context`; it runs validator regression tests and structural validation. It does not prove semantic documentation accuracy, Codex/Hermes semantic routing, runtime behavior, or external systems. Select all other commands from [`docs/agent-context/testing-and-validation.md`](docs/agent-context/testing-and-validation.md).

## Repository skills

- `code-truth-audit`: disputed repository truth, architecture contradictions, or agent-context changes.
- `issue-implementation`: one authorized, bounded implementation issue.
- `delivery-run-diagnostics`: one failed, stuck, stale, duplicated, or externally inconsistent run.
- `database-evidence`: bounded read-only persistence evidence.
- `code-review`: defects in a proposed diff or PR.
- `final-verification`: completion gate after implementation and validation evidence exist.

General helper skills such as `tdd`, `graphify`, and `improve-codebase-architecture` remain optional and cannot weaken the boundaries above.
