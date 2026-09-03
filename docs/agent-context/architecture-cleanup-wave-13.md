# Wave 13 — Targeted Architecture Cleanup

Status: AUDIT IN PROGRESS

## Boundary

- Branch: `wave/13-targeted-cleanup`
- Starting accepted HEAD: `b89744526f685e5d27bcd988b6278e3ba2acaa9`
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

## Acceptance criteria

- Every proposed cleanup records the old problem, canonical owner, proof, safe
  removal rationale, and behavior-preserving tests.
- No compatibility route/helper is removed solely because it is not imported
  by a simple source search.
- Architecture and purity direction remains unchanged.
- Critical findings: 0; Important findings introduced by this wave: 0.
- Exact wave-local diff, checks, runtime limitations, and final decision are
  recorded before acceptance.
