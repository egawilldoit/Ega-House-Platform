# EGA House Evidence and Product Authority

Use the following hierarchies for different questions. Do not collapse them into one precedence list.

## Current-behavior evidence

Use this hierarchy to determine what the repository currently does:

1. Observed runtime, database, and external-system evidence.
2. Executable code and migrations.
3. Tests exercising the current path.
4. Current runbooks and documentation.
5. Historical plans and prompts.

A lower layer may explain intent but cannot prove that a higher-layer behavior occurred.

## Normative product authority

Use this hierarchy to determine what behavior is required:

1. Explicit current user authorization and the assigned issue contract.
2. Approved product invariants and architecture decisions.
3. Versioned product specifications.
4. Current architecture and subsystem contracts.
5. Existing implementation patterns when they do not conflict with higher authority.

> When current implementation conflicts with normative authority, classify the difference as a defect or unresolved product decision. Do not silently normalize the current code and do not silently rewrite product policy.

## Domain authority and known gaps

“Known gap” means current-behavior evidence does not yet prove or enforce the normative rule.

| Domain | Normative rule | Canonical owner/evidence | Forbidden bypass | Known gap |
|---|---|---|---|---|
| Web product | Services and Postgres own task/goal/project truth; UI projects that state | `src/lib/services`, `src/db/schema.ts`, Supabase | Competing workflow truth in UI-only code | Deployed schema may include changes not represented locally |
| Agent API | Token scopes and owner filtering govern external task access | Agent service, handlers, audit tables | Direct unscoped table access from agent routes | In-memory rate limiting is process-local |
| Automation run | `automation.implementation_runs` owns durable run state; events/artifacts provide evidence | Deployed `automation.*`, Runner SQL, migration `0035` | Slack, Hermes output, Git branch names, or queue messages acting as terminal truth | Complete base schema is not versioned here |
| Queue | PGMQ owns pending execution, not terminal state | `scripts/ega-runner/src/queue.ts` | Executable `pgmq.pop()` or deletion before durable classification | Archive preconditions are not centrally encoded |
| Claim/lease | `claimed_by` and `lease_expires_at` establish temporary ownership | `run-lease.ts`, queue VT | Side effects after ownership is uncertain | Heartbeat failure does not immediately terminate active Hermes execution |
| Authorization | A run must be bound to an authorized issue and scope before implementation | `context.ts`, `scope.ts`, persisted context hash | Label-only or prompt-only authorization | Project membership is hardcoded; blocker semantics are not proven |
| Worktree | One verified attempt owns one branch/worktree from a pinned base SHA | `worktree.ts`, persisted attempt fields | Main implementation, branch force-reset, stale worktree reuse | Current implementation uses force-reset and `--force` |
| Hermes | Hermes generates code; Runner owns process lifecycle and independent verification | `hermes-executor.ts`, result/Git evidence | Treating exit code, prose, or result JSON as proof | Validation commands are not independently rerun; repository skill discovery is unverified |
| Git/GitHub | Commit and pushed SHA prove implementation; GitHub owns PR/check state | `result.ts`, `github.ts`, persisted PR fields | Completion without verified commit/push/PR when required | PR failure can still lead to `completed`; existing PR lookup is absent |
| Merge | Human review is the current safe merge authority for Runner PRs | PR state and repository policy | Broad automatic merge or review bypass | Separate docs-only guardian must not become implicit Runner authority |
| Vercel | Vercel is deployment truth by exact commit SHA | `vercel.ts`, Vercel API | Inferring deployment from PR text or Slack | Adapter is not wired into Runner terminal completion |
| Slack | Slack reports projections and operational signals | `notify.ts`, PR-ready workflow | Using messages/markers as durable run state | Delivery state must remain valid when Slack is unavailable |
| Reconciliation | Partial effects must be repaired idempotently by a canonical owner | No current authority | Ad hoc repeated side effects | ABSENT |

## Approval boundaries

Human approval is required for merge, deployment, production data changes, secrets, destructive cleanup, broad migrations, governance changes, and automatic-merge enablement. Issue authorization permits scoped implementation and non-destructive validation; it does not imply those higher-impact permissions.

## Terminal evidence rule

A delivery-level `COMPLETE` verdict requires all evidence demanded by the authorized contract. At minimum for a PR-producing run:

1. Current ownership was maintained through the final owned mutation.
2. Authorized paths and actual changed paths match.
3. A non-empty implementation commit descends from the pinned base SHA.
4. The intended branch was pushed and the remote SHA matches.
5. A real PR exists and points to that SHA.
6. Required validations/checks are independently observed.
7. Preview evidence is present when required.
8. Durable run/event/artifact records were written.

Current Runner code does not prove items 5–7 before `completed`; report that as a current-behavior gap rather than translating the database value into delivery success.
