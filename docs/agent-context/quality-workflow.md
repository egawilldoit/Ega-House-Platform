# Engineering Quality Workflow

This expands the root [agent contract](../../AGENTS.md) for analysis,
implementation, review, and authorized delivery. It is normative working guidance,
not a claim that every check is automated or every deployed path is verified.
Use it with the [validation matrix](testing-and-validation.md), scoped instructions,
and task-specific skills. Scale the work to the changed behavior and risk.

## Establish the problem

Record a short acceptance-to-evidence map: required outcome, current evidence,
affected owner/consumers, and the check that can establish the outcome. A small
fix can use a few sentences; cross-system changes need explicit boundaries.
Distinguish implemented behavior, missing behavior, defects, and unresolved
product decisions using [product authority](product-authority.md).

Trace the relevant path from input and verified actor through contracts, use
cases, persistence/integrations, returned state, and UI/cache. Check adjacent
working examples and versions actually installed. Separate observed facts from
hypotheses; choose an experiment that could disprove the hypothesis before editing.
Source similarity and plausible explanations alone do not prove root cause.

## Continue through engineering problems

| Obstacle | Next action |
|---|---|
| Test failure | Read the failure; separate product defect, faulty assertion/setup, environment mismatch, and regression. Establish a causal reproduction. |
| Unfamiliar dependency/API | Inspect lockfile version, installed types/source, and matching official docs; use a minimal probe where necessary. |
| Local/CI disagreement | Compare exact revision, command, runtime/platform, dependencies, environment, and fixtures before altering behavior. |
| Conflicting changes | Read both changes' intent, reconstruct required behavior, resolve semantically, and verify affected integration. A clean textual merge is insufficient. |
| Unstable test | Investigate timing, shared state, cleanup, and nondeterminism. Repeated reruns alone do not establish acceptance. |
| Tool/network failure | Preserve evidence, try a supported alternative or bounded retry when safe, and distinguish unavailable proof from a product failure. Do not bypass access controls. |
| Repeated failed fixes | Revisit assumptions and reproduction; remove speculative edits. Redesign only for an evidenced ownership/architecture defect. |
| Necessary external/product decision | Finish independent in-scope work; report the exact missing decision/access, attempted checks, residual risk, and smallest action needed to resume. |

Do not stop merely because work is unfamiliar or a check fails. Do not retry an
external write with ambiguous success unless idempotency or observed state makes
it safe. Do not choose a different issue, silently enlarge authorized paths, or
invent product semantics to avoid a real decision.

## Implementation and failure coverage

Keep ownership clear, functions cohesive, and names concrete. Reuse existing
interfaces where they fit. New abstractions/dependencies need an actual use case,
compatibility assessment, and simpler-alternative consideration. Preserve public
exports, wire formats, persisted semantics, and operational compatibility, or
explicitly account for their consumers and rollout. Validate boundary inputs;
do not suppress unexplained type mismatches or swallow errors into apparent success.

Select applicable scenarios; this table is not a mandate to test every row for
every edit. Follow scoped instructions for concrete commands and local patterns.

| Changed boundary | Failure/compatibility questions |
|---|---|
| Mutation/state transition | Duplicate submission, timeout after commit, stale update, concurrent transition, persisted result and returned state agree? |
| Auth/ownership | Missing/expired/invalid credentials; authorized success and cross-user denial; actor remains server-derived? |
| Projection/cache | Mutation invalidates affected views; user switching does not reuse another user's data; counts, status, and timer semantics agree? |
| Dates/timers | Explicit timezone/date boundary; midnight and relevant clock differences; persisted duration versus display? |
| Jobs/integrations | Partial effects, retry exhaustion, duplicate delivery, restart recovery, rate limits, ambiguous success, non-retryable errors? |
| Database | Existing data and constraints, clean install and relevant upgrade path, application/schema ordering, transaction behavior and recovery? |
| Contracts/mobile | Existing clients tolerate changes; wire serialization/error mapping, platform constraints, native versus OTA compatibility? |
| UI | Loading/empty/error/success, failure feedback, keyboard/focus/accessibility, responsive/native navigation, persisted mutation and refresh? |
| Performance/resources | Bounded queries/pagination/body sizes, repeated requests, listener/process cleanup; measure where the risk warrants it? |

Test observable contracts. For defects, prove that the regression fails for the
original cause, then passes after the minimal fix. Source-text assertions can
protect structural invariants but cannot replace database/HTTP/device behavior.
Avoid mocks that bypass the failing boundary. Do not add tests that merely repeat
the implementation or manufacture tests for trivial documentation edits.

## Review procedure

Review the actual base-to-head diff and necessary surrounding code, callers, and
tests. A PR description, bot summary, author assertion, or previous review is a
lead to verify. Apply this general core before subsystem-specific skill checks:

1. Acceptance criteria, scope, canonical owner, and compatibility.
2. Correctness, invalid input/state, failure paths, and recovery.
3. Auth/owner isolation, contracts, persistence, projections, and cache effects.
4. Relevant concurrency, retries, date boundaries, resources, and integrations.
5. Test sensitivity to the original defect and the boundaries actually exercised.
6. Maintainability, unnecessary abstraction, dependencies, and rollout risks.

An independent reviewer is a separate person or agent that did not author the
implementation, given the requirements and precise review range. For substantive
behavioral, governance, or release-sensitive changes this review is required.
If unavailable, leave the review gate incomplete unless explicit task authority
permits a documented alternative; never call a self-review independent.

Each actionable finding includes severity, file/location, concrete failure
scenario, impact or violated invariant, supporting evidence, and the smallest
safe correction. Prioritize correctness before style. Separate blockers from
optional suggestions; do not invent findings to meet a quota. Verify fixes and
re-review conclusions affected by subsequent commits. Zero findings describes
review coverage, not absence of all possible bugs. Existing Runner review skills
add queue/lease/worktree/delivery checks; they do not replace this general core.

## Authorized merge gate

PRs remain open unless the user has authorized merging within this scope. Existing
explicit authorization is sufficient; do not ask again solely because a runbook
mentions approval. It does not authorize bypassing repository protection, enabling
persistent auto-merge, or unrelated production/DB operations.

Immediately before merging:

1. Re-read PR identity, target/base, current remote head, and authorized scope.
2. Map acceptance criteria to observed evidence; confirm applicable required
   checks are complete/passing on the relevant revision. Explain skipped jobs
   using actual path routing and dependency impact; skipped is not executed.
3. Confirm required review and no unresolved blocker. Inspect fixes, not just
   resolved-thread markers. Do not bypass required approvals or protections.
4. Verify integration with the current target. If it moved, assess its delta and
   use required up-to-date/merge-queue checks or validate the combined candidate
   as appropriate. Rebase/cherry-pick/conflict resolution requires fresh affected
   verification; a green old head is not proof of a new candidate.
5. Recheck the head and pin the merge request to it where supported. A changed
   head invalidates affected evidence; do not merge a different revision silently.
6. Observe the merge result and resulting revision. Do not equate submission of
   a merge request, mergeability, or auto-merge scheduling with a completed merge.

## Completion and release

Missing required acceptance evidence blocks the corresponding completion claim.
Missing required runtime/release evidence blocks release. Optional unavailable
checks need an impact statement. A user-authorized change to acceptance/risk must
be explicit about the missing evidence and impact; agents cannot grant themselves
exceptions. It never overrides platform restrictions, required CI, security
invariants, or branch protection. Do not change tests or CI to disguise a gap.

Before a release-sensitive merge, identify affected deployments/clients, schema
compatibility, rollout order, and rollback or roll-forward recovery. Migration
proof uses a disposable database with clean and relevant upgrade paths; production
execution needs its own authorization. Preserve main-only Vercel deployment policy;
do not manufacture preview requirements when previews are intentionally disabled.

After deployment, observe the intended commit/artifact and the affected workflow
under recorded conditions, including an authenticated path when applicable.
Health checks prove reachability only. Mobile bundle/type checks do not prove a
native binary, installation, OTA compatibility, or device behavior. Report each
stage separately: implementation verified, review complete, merged, deployed,
affected runtime verified. Claim only stages actually observed and required by
the task; an analysis-only task does not require a PR or deployment.

For handoff/resumption retain objective/criteria, repository/base/head/worktree,
changes, evidence, remaining hypotheses/work, authorization, and exact blockers.
Recheck live state on resume. Update living docs without rewriting historical
claims. For escaped defects, improve the smallest relevant regression, gate,
instruction, or operational signal; avoid generic rules without a failure mode.
