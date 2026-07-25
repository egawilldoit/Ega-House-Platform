# Autonomous Delivery Lifecycle

## Target identity chain

```text
1 authorized issue
→ 1 delivery/webhook record
→ 1 run
→ 1 attempt
→ 1 isolated worktree
→ 1 Hermes execution
→ verified changes
→ 1 commit
→ 1 pushed branch
→ 1 pull request
→ required checks
→ preview
→ human review/merge
→ deployment synchronization
→ durable completion evidence
```

The repository does not currently model every item as a separate durable aggregate. `automation.implementation_runs` carries run and attempt fields; a separate reconciliation authority is absent.

## Current Runner transitions

| Stage | Current owner | Persisted evidence | Current failure behavior | Status |
|---|---|---|---|---|
| Queue publication | External webhook/Supabase path | PGMQ message + automation row expected | Not repository-proven | EXTERNAL_UNVERIFIED |
| Claim | Runner | `status=preparing`, `claimed_by`, heartbeat, lease | Explicit classification | CURRENT/PARTIAL |
| Context/authorization | Runner + Linear | Events, context fields/hash | Cancels owned run | PARTIAL |
| Scope | Runner | Authorized paths event | Cancels when no paths/violation | CURRENT/PARTIAL |
| Worktree | Runner | base SHA, branch, path, Hermes correlation ID | Throws/cancels | PARTIAL/UNSAFE_REUSE |
| Hermes | Runner process owner | stdout/stderr/result artifacts | Timeout or result failure | CURRENT/PARTIAL |
| Verification | Runner | findings/events, Git evidence | Cancels on scope/commit failure | CURRENT/PARTIAL |
| Push | Runner/Git remote | branch + remote SHA event | Cancels on push/SHA mismatch | CURRENT/PARTIAL |
| PR | Runner/GitHub | nullable PR fields/event | Error is logged but execution continues | PARTIAL/DEFECT |
| Checks | GitHub | Helper exists | Not called by terminal path | SCAFFOLDED |
| Vercel preview | Vercel | Helper exists | Not called by terminal path | SCAFFOLDED |
| Run completion | Runner | `status=completed`, PR fields, evidence manifest | Can occur without PR/check/preview | PARTIAL/DEFECT |
| Merge/deploy sync | Human/external systems | Not durably reconciled by Runner | No canonical recovery | ABSENT/PARTIAL |
| Slack | Runner/workflow | Message/thread marker | Best-effort reporting | CURRENT reporting |
| Reconciliation | None | None | None | ABSENT |

## State layers

Do not collapse these into one “status”:

- Linear issue authorization state.
- Webhook delivery and idempotency state.
- PGMQ message visibility/archive state.
- Automation run state.
- Attempt identity and worktree ownership.
- DB lease and queue visibility ownership.
- Hermes process/result state.
- Git branch/commit/push state.
- GitHub PR/check/review state.
- Vercel preview/production state.
- Slack notification state.

## Terminal semantics

Current database `completed` means the Runner reached its present code path after Git verification and push; it does **not** reliably mean PR, checks, preview, merge, or deployment are complete. Use the final-verification verdicts instead of inferring end-to-end success from this field.

## Required future correction

A safe terminal transition should be a single owned operation that checks expected current owner/state and required evidence, verifies the update affected one row, then archives the queue message. Partial GitHub/Vercel/Slack effects require idempotent reconciliation rather than a second ad hoc run.
