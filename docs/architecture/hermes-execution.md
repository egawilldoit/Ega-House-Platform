# Hermes Execution Contract

## Ownership boundary

The EGA Runner owns process creation, working directory, environment, timeout, output capture, independent validation, push, PR synchronization, check/review observation, and merge-readiness state. Hermes owns scoped code generation and may create a local implementation or repair commit. Hermes cannot certify delivery success.

## Current invocation

`hermes-executor.ts` spawns without a shell:

```text
hermes chat --quiet --query <prompt> --source ega-runner --max-turns <n> --accept-hooks
```

The process runs in the attempt worktree with bounded timeout/turns and `HERMES_YOLO_MODE=0`. Hermes is explicitly told not to push, open a PR, merge, or modify Runner evidence. The result contract is `.ega-runner/hermes-result.json`.

## Repository instruction and skill discovery

The repository contains [`../../HERMES_MASTER_PROMPT.md`](../../HERMES_MASTER_PROMPT.md) and EGA skills under `../../.agents/skills/`, but the Runner invocation alone does not prove that the deployed Hermes profile loads either source.

Hermes supports external skill directories through `skills.external_dirs`. EGA House requires a read-only preflight under the same user/profile as the Runner:

```bash
npm run preflight:hermes-skills
```

The preflight must confirm the six EGA skills are visible from the exact repository directory and are not shadowed by same-name local skills. Missing CLI/config/skills or local shadowing means `DISCOVERY NOT VERIFIED`.

## Context supplied by Runner

- run and issue identifiers;
- pinned base SHA;
- Hermes correlation ID;
- exact authorized product paths;
- validation commands;
- result-file path;
- recovery/repair mode and bounded failure evidence.

The Runner resolves the Linear issue/parent context, but the initial generated Hermes prompt still does not include the complete issue and parent descriptions. That remains a context-quality gap.

## Result recovery evidence

The initial execution and the single result-recovery execution have separate stdout/stderr fields. Evidence persistence writes the initial logs as initial evidence and the recovery logs as recovery evidence; one attempt is not mislabeled as the other.

## Evidence layers

Keep these separate:

1. Hermes process exit/signal/timeout.
2. Initial and recovery/repair stdout/stderr.
3. Hermes result JSON and claims.
4. Actual filesystem changes.
5. Actual Git diff and changed paths.
6. Actual commit identity and ancestry.
7. Runner-owned command results.
8. Pushed remote SHA and verified PR.
9. GitHub checks/reviews and Vercel state.
10. Durable run/event/artifact records.

Only layers 4–10 establish implementation or delivery facts. The result JSON is an input to verification, not proof.

## Remaining gaps

- Full child/parent issue text is not yet embedded in the initial Hermes prompt.
- Lease loss does not immediately cancel every in-flight process/side effect.
- Repository skill discovery remains environment-dependent until proven under the VM service profile.
- Live initial and repair executions have not yet been proven E2E on the deployed Runner.

## Completion rule

A successful Hermes process means only that an implementation candidate may exist. `PR_OPEN`, `READY_TO_MERGE`, `MERGED`, and `DEPLOYED` require independent Runner/external evidence for their respective graph boundaries.
