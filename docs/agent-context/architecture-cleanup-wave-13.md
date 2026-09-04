# Wave 13 — Targeted Architecture Cleanup

Status: ACCEPTED — EXTERNAL EVIDENCE NOT AVAILABLE

## Boundary

- Branch: `wave/13-targeted-cleanup`
- Base after Waves 11/12: `e5567258bdc108cbb1a4a35b4230bf6de93b7863`
  (Wave 12 merge #222; chain `2f2923aa` W10 → `61fba10b` W11 #221 →
  `e5567258` W12 #222, both PRs MERGED). The historical audit began at the
  pre-merge Wave-12 head `b89744526f685e5d27bcd988b6278e3ba2acaa9a`;
  Waves 11/12 are file-disjoint from this wave's three files (verified via
  `git diff --name-only 2f2923aa..e5567258`, empty for these paths), and the
  rebased code diff is byte-identical to the historical true diff.
- Scope: proven duplicate ownership or materially simplifying cleanup in
  `apps/web/src/lib` encountered during Waves 02–12
- Exclusions: repository-wide restructuring, package-topology changes, DB
  ownership changes, hypothetical adapters, and compatibility removal based on
  import search alone

## Decision rule

No cleanup is authorized unless the audit proves an old owner, identifies the
canonical owner, demonstrates duplication or a dead path, and has a safe
caller/test migration path. Compatibility and presentation helpers remain in
place when they still have consumers or contain web-specific behavior.

## Evidence plan

1. Inventory web-local helpers and their callers.
2. Compare candidates against `@ega/domain`, `@ega/application`, shared
   contracts, and existing compatibility guidance.
3. Classify each candidate as retained compatibility/presentation, proven
   duplicate, proven dead, or unresolved.
4. Add regression coverage before any source deletion or ownership change.
5. Run focused architecture/purity tests and affected package checks.

## Initial hypothesis

The large `apps/web/src/lib` tree contains compatibility shims and web-local
read models by design. A targeted audit may find no safe deletion. The wave
must remain useful by recording evidence and making a cleanup only when the
canonical owner and live behavior are proven.

## Audit findings

| Area | Evidence | Classification | Decision |
| --- | --- | --- | --- |
| `task-session.ts` duration label | `apps/web/src/lib/task-session.ts` duplicated the exact `formatDurationLabel` implementation exported by `packages/application/src/shared/duration.ts`; 17 other web files import the helper and application already owns the same formatter | Proven duplicate ownership | Re-export the application formatter from the existing web module so callers keep their import surface while implementation has one owner |
| `task-session.ts` session calculations and Supabase map | Web helpers operate on root `Tables<"task_sessions">` rows and compose web-owned data access; application helpers use its own `SessionDurationRow` and timer ports | Web-specific composition | Retain; no safe ownership move established |
| `task-domain.ts` | Status constants/guards are re-exported from `@ega/domain`; `formatTaskToken` and `getTaskStatusTone` are presentation helpers with live component callers | Compatibility plus presentation | Retain; no duplicate domain ownership |
| `task-recurrence.ts` | Recurrence rules and normalization re-export from `@ega/domain/tasks`; `formatTaskRecurrenceRule` is web display text with live callers | Compatibility plus presentation | Retain |
| `idea-note-domain.ts` | Explicit compatibility aliases delegate to canonical Inbox constants and validators; live Ideas routes/actions still import the aliases | Compatibility shim | Retain; removing it would break the established web import surface without reducing ownership |
| `goal-archive.ts`, `project-archive.ts`, `goal-health.ts`, `goal-next-step.ts` | Canonical archive/health/next-step behavior is imported or re-exported from `@ega/domain/goals` and `@ega/domain/projects`; remaining helpers read web `FormData` or format labels/previews | Compatibility plus web input/presentation | Retain |
| `task-due-date.ts` | Web helper combines process-local input/date formatting and a web `getTaskDueDateState`; domain exposes core predicates with different time-context ownership | Web input/presentation | Retain; direct replacement would change semantics |
| `task-estimate.ts` | Normalization and label formatting are used by web forms/cards; no canonical public equivalent with the same UI contract exists | Web input/presentation | Retain |
| `task-archive.ts` | Owns the web list-view query values (`active`, `archived`, `all`); no matching domain/application owner was found | Web view policy | Retain |
| `timer-domain.ts` | Owns web clock/date formatting; no identical canonical helper with the same display contract was found | Web presentation | Retain |
| `review-week.ts`, `weekly-review-generator.ts`, and service/read-model files | They delegate to canonical domain/application time/review logic and add web composition or display concerns; callers are live | Composition/compatibility | Retain |

The only proven removable duplication in this bounded audit was the duration
label formatter. No dead path or duplicate database/schema authority was
proven. No broad refactor is authorized by this wave.

## Implemented cleanup

`apps/web/src/lib/task-session.ts` now re-exports `formatDurationLabel` from
`@ega/application/shared/duration`. The existing web import surface is
unchanged. `apps/web/src/lib/task-session.test.ts` asserts reference identity
with the canonical application export and preserves representative output
behavior.

## Evidence and review

- Representative callers were enumerated with `rg`; all retained
  compatibility/presentation helpers have live callers.
- The regression was run RED before the re-export change, then GREEN after it:
  7/7 tests passed.
- Existing architecture documentation explicitly permits retained
  compatibility/presentation shims when live consumers exist:
  `ARCHITECTURE.md`, `docs/architecture/platform-monorepo.md`, and
  `docs/architecture/readiness.md`.
- No runtime product behavior changed beyond using the same canonical
  formatter. Authenticated browser and Android runtime evidence are not
  available for this source-level ownership cleanup and remain explicitly
  unverified for this wave.

## Acceptance criteria

- Every proposed cleanup records the old problem, canonical owner, proof, safe
  removal rationale, and behavior-preserving tests.
- No compatibility route/helper is removed solely because it is not imported
  by a simple source search.
- Architecture and purity direction remains unchanged.
- Critical findings: 0; Important findings introduced by this wave: 0.
- Exact wave-local diff, checks, runtime limitations, and final decision are
  recorded before acceptance.

## Final acceptance record

- Historical accepted HEAD (pre-merge base): `ce2db057c7d1dc768b479f68511250ef82c5045f`
- Historical wave-local commits: `764f7a0c..d5014da6` on top of pre-merge
  Wave-12 head `b8974452`
- Post-Wave-12 rebase: the 6 historical wave-local commits were replayed onto
  `e5567258` with zero conflicts; the rebased code diff
  (`apps/web/src/lib/task-session.ts`, `apps/web/src/lib/task-session.test.ts`)
  is byte-identical to the historical true diff (verified via `diff` of both
  diffs). No Wave 11/12 file overlap (see Boundary).
- Code gate: PASS — exact-head Unified Platform Validation run
  `33817829666` completed successfully, including workspace audit,
  architecture/security/purity, package checks, web tests/build, mobile
  checks/bundle, and hygiene.
- Product gate: PASS — the existing web import surface and formatter output
  are preserved while duplicate implementation ownership is removed.
- Runtime gate: ACCEPTED — EXTERNAL EVIDENCE NOT AVAILABLE. This is a
  source-level ownership cleanup with no new product flow; authenticated web
  and Android runtime evidence remain unavailable in this environment.
- Review gate: PASS — wave-local review found no Critical or Important issue;
  no broad refactor or boundary change was introduced.
- Publication gate: PASS — branch is pushed, PR #223 remains Draft, exact-head
  API Vercel status is `Canceled by Ignored Build Step`, and no production
  deployment or merge occurred.
- Rebase-gate (post-Wave-12): the final exact-head validation run ID, final
  HEAD SHA, and merge SHAs are recorded in the PR #223 body (mutable PR
  metadata, updated after exact-head CI is green). This document is frozen at
  the rebased HEAD so exact-head CI evidence stays valid; no further document
  amendment follows the green run.
