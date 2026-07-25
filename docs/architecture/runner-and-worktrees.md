# Runner and Worktrees

## Entry point

```bash
cd scripts/ega-runner
npm start
```

`src/main.ts` verifies the automation schema, installs signal handlers, polls one PGMQ message at a time, and executes either smoke or full-pipeline mode.

## Attempt identity

Current identifiers include:

- durable run UUID,
- `attempt_number` field on the run,
- branch `hermes/<issue-identifier>-<attempt>`,
- worktree `/tmp/ega-runner-worktrees/<run-id>/<attempt>`,
- Hermes correlation ID `ega:<run-id>:attempt:<attempt>`.

The target invariant is one verified attempt → one branch → one worktree. A retry that needs new implementation work must use a new attempt identity.

## Current worktree behavior

`worktree.ts`:

1. fetches `origin`,
2. pins `origin/<baseBranch>`,
3. creates the deterministic branch,
4. force-resets it when it already exists,
5. creates a deterministic directory,
6. runs `git worktree add --force`.

Steps 4 and 6 violate stale-attempt isolation. Agents must not cite the comments “never reuse stale attempts” as enforced behavior.

## Safe change requirements

Before making worktree behavior production-reliable:

- Reject `main`/protected target branches for implementation.
- Refuse an existing branch unless it is proven to belong to the same untouched attempt.
- Refuse an existing worktree/path unless ownership and Git state match the persisted attempt.
- Never force-reset a branch that may contain evidence or user work.
- Persist base SHA, branch, path, and owner before invoking Hermes.
- Recheck ownership before push, PR creation, terminal transition, and cleanup.
- Cleanup only after evidence is copied and the branch/worktree is safe to remove.
- Preserve failed/stale evidence for reconciliation.

## Shutdown and lease loss

SIGINT/SIGTERM stops new polling and leaves the queue message to reappear. Hermes runs in a detached process group and can be killed on timeout. Current lease-loss handling does not immediately kill the process; treat immediate cancellation and side-effect fencing as required follow-up work.

## Validation

Use the commands in [`../agent-context/testing-and-validation.md`](../agent-context/testing-and-validation.md), including a disposable real Git repository for branch collisions, dirty trees, stale paths, and cleanup behavior.
