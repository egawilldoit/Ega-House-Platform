# EGA House Product Authority

This document records current authority boundaries. “Known limitation” means the repository does not yet fully enforce the intended rule.

| Domain | Rule | Authoritative paths/persistence | Forbidden bypass | Known limitation |
|---|---|---|---|---|
| Web product | Services and Postgres own task/goal/project truth; UI projects that state | `src/lib/services`, `src/db/schema.ts`, Supabase | Writing competing workflow state from UI-only code | Deployed schema may include changes not represented in a local environment |
| Agent API | Token scopes and owner filtering govern external task access | `src/lib/services/agent-task-service.ts`, agent handlers, audit tables | Direct unscoped table access from agent routes | In-memory rate limiting is process-local |
| Automation run | `automation.implementation_runs` is durable run truth; events/artifacts are evidence | Deployed `automation.*`, Runner SQL, migration `0035` | Slack, Hermes output, Git branch names, or queue messages acting as terminal truth | Complete base schema is not versioned in this repository |
| Queue | PGMQ owns pending execution, not terminal state | `scripts/ega-runner/src/queue.ts` | `pgmq.pop()` or deletion before durable terminal evidence | Archive preconditions are not centrally encoded as a state machine |
| Claim/lease | `claimed_by` and `lease_expires_at` establish temporary ownership | `run-lease.ts`, queue VT | Side effects by a worker after ownership is uncertain | Heartbeat failure does not immediately terminate active Hermes execution |
| Authorization | A run must be bound to an authorized issue and scope before implementation | `context.ts`, `scope.ts`, persisted context hash | Label-only or prompt-only authorization without validating project/blockers/scope | Project membership is hardcoded; blocker semantics are not proven |
| Worktree | One verified attempt must own one branch/worktree derived from a pinned base SHA | `worktree.ts`, persisted `base_sha`, `branch_name`, `worktree_path` | Main-branch implementation, branch force-reset, or stale worktree reuse | Current implementation uses force-reset and `--force` |
| Hermes | Hermes generates code; Runner owns process lifecycle and independent verification | `hermes-executor.ts`, `result.ts`, Git evidence | Treating exit code, prose, or result JSON as proof | Reported validation commands are not independently rerun by Runner |
| Git/GitHub | Git commit and pushed SHA prove implementation; GitHub owns PR/check state | `result.ts`, `github.ts`, persisted PR fields | Declaring completion without a verified commit/push/PR where required | PR failure can still lead to `completed`; existing PR detection is absent |
| Merge | Human review is the current safe merge authority for Runner PRs | PR state and repository policy | Broad automatic merge or bypassing review | Separate docs-only guardian exists and must not become implicit Runner authority |
| Vercel | Vercel is deployment truth by exact commit SHA | `vercel.ts`, Vercel API | Inferring deployment from PR text or Slack | Adapter is not wired into Runner terminal completion |
| Slack | Slack reports projections and operational signals | `notify.ts`, `.github/workflows/slack-pr-ready.yml` | Using Slack messages/markers as durable run state | Delivery can complete/fail regardless of Slack availability |
| Reconciliation | A future reconciler must repair partial effects idempotently | No current authority | Ad hoc repeated side effects | ABSENT |

## Approval boundaries

Human approval is required for merge, deployment, production data changes, secrets, destructive cleanup, broad migrations, governance changes, and automatic-merge enablement. Issue authorization permits scoped implementation and non-destructive validation; it does not imply permission for those higher-impact actions.

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

Current Runner code does not prove items 5–7 before `completed`; agents must report that limitation rather than translating `completed` into delivery success.
