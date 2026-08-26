# EGA Runner Agent Instructions

Scope: everything under `scripts/ega-runner/`. These rules extend the repository-root [`AGENTS.md`](../../AGENTS.md).

This subsystem is safety-critical. It turns queued delivery intent into branches/worktrees/agent execution/PR evidence. Read [`../../docs/architecture/delivery-lifecycle.md`](../../docs/architecture/delivery-lifecycle.md), [`../../docs/architecture/queue-and-leases.md`](../../docs/architecture/queue-and-leases.md), [`../../docs/architecture/runner-and-worktrees.md`](../../docs/architecture/runner-and-worktrees.md), and [`../../docs/architecture/hermes-execution.md`](../../docs/architecture/hermes-execution.md) before changing lifecycle semantics.

## Queue invariants

- Preserve the canonical direction: `pgmq.read()` → lease/claim → execute/classify → archive only after the correct terminal outcome.
- Never introduce executable `pgmq.pop()` queue consumption.
- A message becoming visible again is retry/recovery behavior, not permission for two workers to own it concurrently.
- Archive only after verified terminal success or the explicitly defined non-retryable terminal classification.
- Keep lease ownership, stale-worker recovery, and idempotency explicit. Do not turn timing assumptions into ownership proof.

## Execution proof

- Hermes/model output is untrusted execution evidence. Exit code `0`, JSON claiming success, or a textual completion message is not sufficient proof.
- Verify repository state independently: branch/worktree, commits, diff, tests, push/PR state, expected changed paths, and required GitHub checks.
- Keep the prompt/executor boundary deterministic enough to diagnose. Do not hide authoritative state transitions in log parsing.
- Skills/instructions may guide an executor; they cannot self-certify the resulting repository state.

## Git/worktree/PR invariants

- Never implement in the main checkout on `main`.
- One attempt owns its worktree/branch identity; do not silently recycle a dirty/stale attempt as a new one.
- Never destroy unrelated worktrees or force-delete branches to make cleanup pass.
- PR creation/update is evidence publication. Merge remains a separate authorized action.
- Preserve cleanup and recovery behavior for cancelled, failed, stale, and successful attempts.

## External reporting

Slack and progress reporting are side effects. A reporting failure must not become delivery truth, and a reporting success must not mark an implementation complete.

Never place credentials, token values, raw environment secrets, or authenticated remote URLs in logs/prompts/artifacts.

## Validation

From repository root:

```bash
npm run typecheck:ega-runner
npm run test:ega-runner-pr-loop
npm run validate:agent-context
```

Run focused Runner tests that cover any touched lifecycle component. For changes that affect queue/source scanning or architecture guardrails, also run the relevant repository CI/architecture checks.

Use smoke mode only when its environment requirements are intentionally satisfied; do not present an unavailable external dependency as a passing runtime proof.

## Do not

- use `pgmq.pop()`;
- archive before the lifecycle contract permits it;
- trust executor self-report as completion evidence;
- collapse lease, execution, validation, PR, and merge into one opaque state;
- auto-merge merely because tests or Slack are green;
- weaken cleanup/recovery semantics to hide dirty worktrees or stale attempts.
