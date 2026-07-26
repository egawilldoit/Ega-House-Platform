# Runner and Worktrees

## Entry point

```bash
cd scripts/ega-runner
npm start
```

`src/main.ts` verifies the automation schema, installs signal handlers, monitors durable PR states, and polls one PGMQ implementation message at a time.

## Attempt identity

Each attempt uses:

- durable run UUID;
- positive `attempt_number`;
- branch `hermes/<issue-identifier>-<attempt>`;
- worktree `/tmp/ega-runner-worktrees/<run-id>/<attempt>`;
- Hermes correlation ID `ega:<run-id>:attempt:<attempt>`.

The enforced invariant is one attempt → one local branch → one worktree. A retry requiring a fresh implementation must use a new attempt identity.

## Current worktree behavior

`worktree.ts` now:

1. validates the durable run/attempt identity;
2. validates the queue-provided base branch with `git check-ref-format --branch`;
3. calls Git only through `execFileSync` argument arrays;
4. fetches `origin` and pins the exact remote base commit;
5. rejects an existing attempt branch;
6. rejects an existing attempt worktree path;
7. creates the branch and worktree without force-reset or `git worktree add --force`;
8. removes a partially created branch if worktree creation fails.

Queue values are never interpolated into shell commands. Existing branch/path collisions fail closed so stale evidence or user work is not overwritten.

## Repair worktree behavior

Automated PR repairs use the same persisted worktree and branch only when both still match the stored PR head. Before resetting a rejected repair, the Runner preserves:

- tracked/committed binary diff;
- product status;
- bounded untracked-file inventory and contents;
- Hermes output and validation evidence.

Every rejected repair is reset to the previously observed PR head, including exhausted or human-escalated attempts. Once a repair commit reaches the remote, the Runner never resets it locally as though the push did not happen; post-push persistence failures move to reconciliation-required human review.

## Remaining safe-change requirements

- Reject protected implementation targets through project/branch policy, not only naming validation.
- Persist explicit worktree ownership metadata if multiple Runner hosts are introduced.
- Recheck ownership before every destructive cleanup.
- Add automatic stale-attempt creation and reconciliation.
- Keep failed/stale evidence until retention policy authorizes removal.

## Shutdown and lease loss

SIGINT/SIGTERM prevents new queue claims. Hermes runs in a detached process group and is terminated on timeout. Current lease-loss detection is checked before queue archival, but it does not yet actively interrupt every in-flight subprocess and external side effect; immediate cancellation/fencing remains follow-up work.

## Validation

Use the commands in [`../agent-context/testing-and-validation.md`](../agent-context/testing-and-validation.md), including a disposable real Git repository for branch collisions, dirty trees, stale paths, untracked evidence, and cleanup behavior.
