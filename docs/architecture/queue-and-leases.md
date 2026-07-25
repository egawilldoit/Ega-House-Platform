# Queue and Lease Contract

## Canonical queue flow

```text
pgmq.read(queue, visibility_timeout, 1)
→ load durable run
→ atomically claim queued/unowned run
→ persist claim event
→ renew DB lease + queue visibility timeout
→ perform owned work
→ persist terminal state/evidence
→ archive message only when classification permits
```

`pgmq.pop()` is forbidden because it removes work before durable processing and recovery are proven. `scripts/agent/validate-agent-context.mjs` checks Runner source for direct use.

## Claim outcomes

| Outcome | Required handling |
|---|---|
| `CLAIMED` | Process under the acquired owner/lease; archive only after the callback reaches a durable terminal path |
| `ACTIVE_VALID_LEASE` | Preserve; another worker owns the run |
| `STALE_EXPIRED_LEASE` | Atomically mark stale, preserve prior owner evidence, then archive obsolete message |
| `TERMINAL` | Archive obsolete message |
| `NOT_FOUND` | Current code archives; retain diagnostic evidence before relying on this in production |
| `CLAIM_RACE_LOST` | Preserve for retry |
| `UNKNOWN_INCONSISTENT_STATE` | Fail closed and preserve |

## Ownership

The DB lease and PGMQ visibility timeout are complementary:

- PGMQ prevents immediate redelivery.
- `claimed_by` identifies the worker.
- `lease_expires_at` bounds temporary ownership.
- Heartbeat renews both indicators.

A worker must not finalize, archive, push, create a PR, or send authoritative completion signals after ownership loss.

## Current gaps

- Heartbeat runs in an interval and records a failure flag, but active work is not immediately cancelled. Side effects can continue until the callback returns.
- Owned SQL updates frequently do not verify that exactly one row changed.
- Archive preconditions are distributed through `main.ts` rather than represented by one transition service.
- No dead-letter/retry policy or reconciliation loop is versioned.
- `NOT_FOUND` and malformed messages are archived by current code; production policy and evidence requirements are not fully documented elsewhere.

## Retry and idempotency requirements

Future changes must make these operations safe to replay:

- webhook-to-run creation,
- queue publication,
- claim after visibility expiry,
- branch/worktree preparation,
- branch push,
- PR lookup/create,
- check/preview synchronization,
- Slack reporting,
- terminal transition and archive.

Do not solve duplicate delivery by deleting messages early. Bind each external effect to stable run/attempt/commit identifiers and look up existing effects before creating new ones.
