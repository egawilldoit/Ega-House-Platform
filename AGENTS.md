# EGA House Agent Instructions

This file is the stable repository-wide entry point for coding agents. Keep it short enough to load reliably; deeper product, architecture, evidence, tooling, and validation detail belongs in the linked documents.

## Mission

Work on EGA House as one product with multiple transports: Next.js web, Expo mobile, the standalone Hono API, shared workspace packages, and the autonomous-delivery Runner. Preserve product semantics, repository authority, security boundaries, and reviewability while making the smallest authorized coherent change.

## Read order

Before non-trivial work, follow this path rather than guessing from filenames:

1. [`CONTEXT.md`](CONTEXT.md) — product loop, domain vocabulary, and cross-surface mental model.
2. [`docs/agent-context/product-authority.md`](docs/agent-context/product-authority.md) — separate current-behavior evidence from normative product authority.
3. [`ARCHITECTURE.md`](ARCHITECTURE.md) — current system map and implementation status.
4. [`docs/architecture/platform-monorepo.md`](docs/architecture/platform-monorepo.md) — application/package boundaries and dependency direction.
5. The architecture document for the subsystem being changed.
6. [`docs/agent-context/decision-log.md`](docs/agent-context/decision-log.md) — prior code-vs-authority conflict classifications; this log records decisions but never outranks product authority.
7. [`docs/agent-context/tooling-map.md`](docs/agent-context/tooling-map.md) — how Codex, Claude, OpenCode, Hermes, and repository skills consume this guidance.
8. [`docs/agent-context/testing-and-validation.md`](docs/agent-context/testing-and-validation.md) — validation matrix and evidence labels.

## Evidence model

Do not collapse “what the repository does” and “what the product requires” into one precedence list.

- Determine current behavior from runtime/database/external evidence first, then executable code and migrations, tests, current runbooks, and finally historical plans.
- Determine required behavior from the current authorized task, approved invariants/ADRs, versioned specifications, current architecture contracts, then existing patterns when they do not conflict.
- When they disagree, classify the gap as a **defect** or **unresolved product decision**. Do not silently rewrite either side to match the other.
- Search [`docs/agent-context/decision-log.md`](docs/agent-context/decision-log.md) before re-classifying a known conflict. Record a new material classification when the task authorizes repository documentation changes; otherwise report the proposed log entry in the handoff.

## Non-negotiable safety invariants

- Never implement directly on `main`. Use an authorized task branch or a verified Runner-owned worktree.
- Keep work bounded to the assigned issue/contract and its necessary tests/evidence. Do not opportunistically implement the backlog.
- Preserve one canonical owner for durable state. UI, Slack, branch names, queue messages, and agent prose are projections/evidence, not competing truth stores.
- Preserve the Runner queue direction: `pgmq.read()` → lease/claim → durable classification → `pgmq.archive()` only when the message is durably safe to archive. Executable `pgmq.pop()` is forbidden.
- Stop owned side effects when lease/ownership becomes uncertain.
- Hermes output, exit code, validation prose, and result JSON are candidate evidence only. Independently verify changed paths, Git state, commit ancestry, pushed SHA, PR/check state, and any required runtime/preview evidence.
- Do not force-reuse stale worktrees/attempts or mutate unrelated developer work.
- Slack is reporting-only; delivery state must remain valid when Slack is unavailable.
- Runner-created PRs require human review/merge unless a separate explicit authorization changes that policy.
- Never expose or commit secrets, tokens, credentials, private keys, service-role keys, or sensitive environment values.

## Platform architecture boundaries

The repository is an npm-workspace monorepo:

```text
apps/web       Next.js web transport/rendering + compatibility API routes
apps/mobile    Expo native client
apps/server    Hono HTTP API for the canonical mobile API surface
packages/domain
packages/contracts
packages/application
packages/data-access
packages/api-client
src/db         root database/schema authority
drizzle        root migration authority
scripts/ega-runner  autonomous delivery subsystem
```

The intended dependency direction is enforced by `scripts/architecture/check-boundaries.mjs`:

```text
apps/web      -> domain/contracts/application/data-access
apps/server   -> domain/contracts/application/data-access
apps/mobile   -> domain/contracts/api-client
api-client    -> contracts
application   -> domain/contracts + repository ports
data-access   -> application ports + request-scoped Supabase
contracts/domain -> platform-neutral code
```

Do not move workflow/business authority into React components, route handlers, Expo screens, Hono handlers, or transport-specific DTO glue. Domain rules belong in `@ega/domain`; use-case orchestration belongs in `@ega/application`; persistence adapters belong in `@ega/data-access`; transport-neutral wire contracts belong in `@ega/contracts`.

For authenticated native API requests, identity comes from a verified Supabase bearer token. The server derives the actor and uses a request-scoped Supabase client so RLS remains an enforcement boundary. Never accept actor identity from request payload/query/custom user-id headers and never use a service-role shortcut for normal user-scoped product requests.

Database/schema authority remains at root (`src/db`, `drizzle/`, `drizzle.config.ts`) until a separate explicit ownership decision changes it. Do not create a second schema/migration authority under an app workspace.

## Approval boundaries

Normal authorized implementation may read repository/external evidence, edit in-scope files on a task branch/worktree, add focused tests, and run non-destructive validation.

Require explicit approval before merge, deployment, production data mutation, destructive cleanup, broad migrations, secret/config changes with external impact, force-push, automatic-merge enablement, or weakening governance/security gates. Issue authorization does not imply those permissions.

## Default working method

1. Identify the exact task/issue, acceptance criteria, authorized paths, base branch/SHA, and required evidence.
2. Confirm branch/worktree isolation before editing.
3. Read the product context, current architecture, relevant ADR/subsystem docs, and existing decision-log entries.
4. Trace the canonical implementation, callers, persistence, tests, and executable boundary checks.
5. Separate already-working behavior, defects, unresolved product decisions, and documentation drift.
6. Make the smallest coherent change through the canonical owner; do not create duplicate authority.
7. Add/update behavior-focused tests or structural guardrails at the closest reliable seam.
8. Run the validation matrix for every changed subsystem and record exact results rather than remembered counts.
9. Inspect the final diff, changed paths, generated/untracked artifacts, secrets, and unrelated changes before handoff.
10. State what is proven, what is only structurally supported, what was not run, and what still requires human/external action.

## Repository navigation

- Product model: [`CONTEXT.md`](CONTEXT.md)
- Current system map: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Agent start-here index: [`docs/agent-context/index.md`](docs/agent-context/index.md)
- Evidence/product authority: [`docs/agent-context/product-authority.md`](docs/agent-context/product-authority.md)
- Decision log: [`docs/agent-context/decision-log.md`](docs/agent-context/decision-log.md)
- Tool loading map: [`docs/agent-context/tooling-map.md`](docs/agent-context/tooling-map.md)
- Validation matrix: [`docs/agent-context/testing-and-validation.md`](docs/agent-context/testing-and-validation.md)
- Platform monorepo: [`docs/architecture/platform-monorepo.md`](docs/architecture/platform-monorepo.md)
- Platform ADRs: [`docs/architecture/decisions/`](docs/architecture/decisions/)
- Hono deployment: [`docs/architecture/hono-deployment.md`](docs/architecture/hono-deployment.md)
- Delivery lifecycle: [`docs/architecture/delivery-lifecycle.md`](docs/architecture/delivery-lifecycle.md)
- Queue/leases: [`docs/architecture/queue-and-leases.md`](docs/architecture/queue-and-leases.md)
- Runner/worktrees: [`docs/architecture/runner-and-worktrees.md`](docs/architecture/runner-and-worktrees.md)
- Hermes execution: [`docs/architecture/hermes-execution.md`](docs/architecture/hermes-execution.md)
- Web application: `apps/web`
- Mobile application: `apps/mobile`
- Standalone API: `apps/server`
- Shared packages: `packages/*`
- Database/migrations: `src/db`, `drizzle/`
- Runner: `scripts/ega-runner`

Historical audit/readiness/planning artifacts are evidence for the date/branch they name. They do not outrank the living documents above or current executable evidence.

## Agent and skill routing

Root `AGENTS.md` is the repository governance source; do not maintain drifted copies per tool. `CLAUDE.md` deliberately delegates to this file. Current OpenCode and Codex repository discovery use `AGENTS.md`; Hermes uses repository skills plus `HERMES_MASTER_PROMPT.md` as a compact fallback/entry contract. See [`docs/agent-context/tooling-map.md`](docs/agent-context/tooling-map.md) before changing tool-specific configuration.

Use specialized EGA House skills when their trigger matches:

- `code-truth-audit` — disputed repository truth, architecture contradictions, or agent-context changes.
- `issue-implementation` — one authorized bounded implementation issue.
- `delivery-run-diagnostics` — runtime chronology and failure localization.
- `database-evidence` — read-only persistence evidence.
- `code-review` — proposed-diff/PR review.
- `final-verification` — evidence-based completion/handoff gate.

Do not invoke specialized skills merely because their names exist. Skill routing expectations live in [`docs/agent-context/skill-routing-evaluation.md`](docs/agent-context/skill-routing-evaluation.md).

## Validation

For agent/governance/architecture-context changes, minimum validation is:

```bash
npm run validate:agent-context
npm run check:architecture
npm run test:architecture
```

Then run the subsystem commands required by [`docs/agent-context/testing-and-validation.md`](docs/agent-context/testing-and-validation.md). A declared command, file existence, static pattern, or agent claim is not runtime proof.