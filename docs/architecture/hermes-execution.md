# Hermes Execution Contract

## Ownership boundary

The EGA Runner owns process creation, working directory, environment, timeout, cancellation, output capture, and independent verification. Hermes owns scoped code generation and may create a local implementation commit. Hermes cannot certify that a delivery succeeded.

## Current invocation

`hermes-executor.ts` spawns without a shell:

```text
hermes chat --quiet --query <prompt> --source ega-runner --max-turns <n> --accept-hooks
```

The process runs in the attempt worktree, in its own process group, with bounded timeout/turns and `HERMES_YOLO_MODE=0`. The result contract is `.ega-runner/hermes-result.json`.

## Context supplied

- run and issue identifiers,
- pinned base SHA,
- Hermes correlation ID,
- authorized product paths,
- validation commands,
- result-file path,
- recovery-mode flag.

The Runner also resolves Linear issue/parent context, but the current generated Hermes prompt does not include the full issue description/parent specification. That is a context-quality gap.

## Evidence layers

Keep these separate:

1. Hermes process exit code/signal/timeout.
2. Hermes stdout/stderr.
3. Hermes result JSON and natural-language claims.
4. Actual filesystem changes.
5. Actual Git diff and changed paths.
6. Actual implementation commit and ancestry.
7. Pushed remote SHA.
8. GitHub PR/check state.
9. Vercel deployment state.
10. Durable run/event/artifact records.

Only layers 4–10 can establish external implementation/delivery facts. The result JSON is an input to verification, not proof.

## Current contradictions

- The prompt instructs Hermes to create a PR, while `main.ts` also owns PR creation. Future work should choose one canonical owner; current architecture favors Runner-owned idempotent synchronization.
- Hermes reports validation results, but Runner does not independently rerun the commands.
- Recovery asks Hermes to write only the result file and checks the HEAD SHA, but uncommitted filesystem changes also need explicit protection.
- Lease loss does not immediately cancel the process.

## Completion rule

A successful Hermes process may justify “implementation candidate produced.” It must not produce `COMPLETE` until the Runner independently proves the required Git, validation, PR, check, and preview evidence for the authorized contract.
