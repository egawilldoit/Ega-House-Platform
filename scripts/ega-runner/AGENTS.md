# EGA Runner Agent Instructions

Scope: `scripts/ega-runner/`. This safety-critical subsystem extends the root
[`AGENTS.md`](../../AGENTS.md). Read [`../../docs/architecture/delivery-lifecycle.md`](../../docs/architecture/delivery-lifecycle.md),
[`../../docs/architecture/queue-and-leases.md`](../../docs/architecture/queue-and-leases.md),
[`../../docs/architecture/runner-and-worktrees.md`](../../docs/architecture/runner-and-worktrees.md),
and [`../../docs/architecture/hermes-execution.md`](../../docs/architecture/hermes-execution.md).

## Queue and proof invariants

- Consume `pgmq.read()` → lease/claim → execute/classify → archive only at the
  correct terminal outcome. Never add executable `pgmq.pop()`. A visible-again
  message is recovery/retry, not concurrent ownership; keep lease, heartbeat,
  stale-worker, and idempotency evidence explicit.
- Hermes/model exit codes, text, JSON, skills, and Slack reports are untrusted.
  Independently verify branch/worktree, commits/diff, scope, tests, push/remote
  SHA, PR, checks, reviews, and lifecycle state.
- One attempt owns one isolated worktree/branch. Do not recycle dirty attempts,
  destroy unrelated worktrees, reset remote history, auto-merge, or treat Slack
  as delivery authority. PR publication is evidence; merge stays human-authorized.
- Never log credentials, raw authenticated URLs, or environment secrets.

## Proof

```text
npm run typecheck:ega-runner
npm run test:ega-runner-pr-loop
npm run validate:agent-context
```

Run focused lifecycle tests for touched code and repository architecture/CI
checks for queue or guardrail changes. Use smoke mode only when its external
requirements are genuinely satisfied; report unavailable integrations as such.
