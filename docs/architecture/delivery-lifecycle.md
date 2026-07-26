# Autonomous Delivery Lifecycle

## Target identity chain

```text
1 authorized Linear issue
→ 1 webhook delivery
→ 1 durable run and attempt
→ 1 isolated worktree
→ 1 Hermes implementation
→ independently verified changes
→ 1 verified commit and pushed branch
→ 1 verified pull request
→ checks/reviews/preview observation
→ bounded repair attempts when needed
→ human-approved merge
→ deployment synchronization
→ durable evidence
```

## Implemented Runner graph

```text
QUEUED
→ PREPARING
→ RUNNING
→ PR_OPEN
→ REPAIRING ↺
→ AWAITING_REVIEW
→ READY_TO_MERGE
→ MERGED
```

Failure/stop states are `VALIDATION_FAILED`, `PR_FAILED`, `NEEDS_HUMAN`, `FAILED`, `CANCELLED`, and `STALE`. Detailed reasons remain in `failure_code` and append-only implementation events.

## Current stage ownership

| Stage | Authority | Durable evidence | Current classification |
|---|---|---|---|
| Webhook authorization | Linear + ingress | delivery/run/queue records | EXTERNAL_UNVERIFIED |
| Queue claim and leases | Runner + PGMQ | owner, heartbeat, VT, events | CURRENT/PARTIAL |
| Linear context and scope | Runner + Linear | context hash, parent, authorized paths | CURRENT/PARTIAL |
| Worktree and Hermes | Runner / Hermes | branch, worktree, correlation ID, logs | CURRENT/PARTIAL |
| Scope/commit validation | Runner | findings, changed files, commit SHA | CURRENT/PARTIAL |
| Command validation | Runner | bounded command results | CURRENT/PARTIAL |
| Push and remote SHA | Runner / Git remote | branch and exact remote SHA | CURRENT/PARTIAL |
| PR creation | Runner / GitHub | exact PR number, URL, head/base/SHA | CURRENT/PARTIAL |
| Checks and reviews | GitHub, observed by Runner | check/review snapshots and events | CURRENT/PARTIAL |
| Repair | Hermes edits; Runner verifies | repair count, logs, patches, new SHA | CURRENT/PARTIAL |
| Vercel preview | Vercel, observed by Runner | exact-SHA preview URL/state | OPTIONAL/PARTIAL |
| Merge | Human/GitHub by default | GitHub merge state | CURRENT external gate |
| Deployment sync | Vercel/Runner | production SHA | ABSENT/PARTIAL |
| Reconciliation | none | none | ABSENT |

## Terminal semantics

`pr_open` means all of the following were independently proven:

- a scoped implementation commit exists;
- Runner-owned commands passed;
- the branch was pushed;
- remote SHA equals the verified local SHA;
- exactly one PR was created or reused;
- its head branch, base branch, and head SHA match the owned run.

`ready_to_merge` means the observed PR head still matches the owned SHA, required checks are complete and passing, the configured preview gate is satisfied, no unresolved review blocker remains, and GitHub reports approval. It does not itself merge the PR unless explicit auto-merge configuration is enabled; that request is pinned to the exact observed head SHA.

`merged` is observed from GitHub. It is not equivalent to production deployment.

## Repair semantics

A repair is triggered only by failed checks or review findings newer than the last completed repair. The Runner:

1. atomically claims one repair attempt;
2. verifies the persisted worktree still matches the PR branch and head;
3. supplies bounded failed logs/comments to Hermes;
4. requires a new descendant commit;
5. rechecks authorized scope and runs configured commands;
6. pushes and verifies the new remote SHA;
7. returns the run to `pr_open`.

Retryable failures preserve tracked and bounded untracked evidence, then reset the isolated worktree to the previously observed PR head. History rewrites, external branch changes, scope violations, missing worktrees, conflicts, or exhausted retries produce `needs_human`. If a repair commit already reached the remote, the Runner preserves that head and enters reconciliation-required human review instead of resetting local history.

## Remaining graph gaps

- Real webhook/database state remains externally unverified from this repository alone.
- GitHub branch rules must be configured operationally.
- The monitor uses polling rather than signed GitHub webhook ingestion.
- Automatic stale-attempt creation and cross-system reconciliation are absent.
- Production-deployment synchronization remains incomplete.
- Live VM proof is required before claiming the full E2E loop is operational.
