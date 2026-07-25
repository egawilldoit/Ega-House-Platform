# Hermes Execution Contract

## Ownership boundary

The EGA Runner owns process creation, working directory, environment, timeout, cancellation, output capture, and independent verification. Hermes owns scoped code generation and may create a local implementation commit. Hermes cannot certify that a delivery succeeded.

## Current invocation

`hermes-executor.ts` spawns without a shell:

```text
hermes chat --quiet --query <prompt> --source ega-runner --max-turns <n> --accept-hooks
```

The process runs in the attempt worktree with bounded timeout/turns and `HERMES_YOLO_MODE=0`. The result contract is `.ega-runner/hermes-result.json`.

## Repository instruction and skill discovery

The repository contains [`../../HERMES_MASTER_PROMPT.md`](../../HERMES_MASTER_PROMPT.md) and EGA skills under `../../.agents/skills/`, but the current Runner invocation does not by itself prove that the deployed Hermes profile loads either source.

Hermes supports external skill directories through `skills.external_dirs`. EGA House requires a read-only preflight under the same user/profile as the Runner:

```bash
npm run preflight:hermes-skills
```

The preflight must confirm the six EGA skills are visible and not shadowed by same-name local skills. Missing Hermes CLI, unsupported commands, missing skills, or local shadowing means `DISCOVERY NOT VERIFIED`; it is not permission to claim specialized workflow loading.

## Context supplied by Runner

- run and issue identifiers,
- pinned base SHA,
- Hermes correlation ID,
- authorized product paths,
- validation commands,
- result-file path,
- recovery-mode flag.

The Runner resolves Linear issue/parent context, but the generated Hermes prompt does not include the complete issue/parent specification. That remains a context-quality gap.

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

Only layers 4–10 can establish external implementation or delivery facts. The result JSON is an input to verification, not proof.

## Current contradictions

- The prompt instructs Hermes to create a PR while `main.ts` also attempts PR creation.
- Hermes reports validation results, but Runner does not independently rerun commands.
- Recovery protects HEAD but uncommitted filesystem changes need explicit protection.
- Lease loss does not immediately cancel the process.
- Repository skill discovery is environment-dependent and has not been proven for the deployed Runner profile.

## Completion rule

A successful Hermes process may justify “implementation candidate produced.” It must not produce `COMPLETE` until the Runner independently proves the required Git, validation, PR, check, preview, and durable evidence for the authorized contract.
