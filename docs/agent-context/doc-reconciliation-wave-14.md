# Wave 14 — Living Documentation and Agent-Context Reconciliation

Status: AUDIT STARTED — ACCEPTANCE PENDING

## Boundary

- Branch: `wave/14-doc-reconciliation`
- Starting accepted HEAD: `6d4c0a7f878b414c391b3f5ccaab3a94b95a5ef7`
- Scope: proven stale living statements about deployment, Runner readiness,
  API/feature surfaces, mobile delivery, architecture ownership, testing,
  and agent-context discovery.
- Exclusions: rewriting historical reports, changing product behavior,
  weakening validation, editing user-global configuration, and speculative
  runtime claims.

## Evidence method

1. Compare living docs with current source, checked-in configuration, tests,
   and accepted wave evidence.
2. Keep historical snapshots historical; update only current guidance.
3. Record each changed claim as old statement, contrary evidence, corrected
   statement, and evidence.
4. Measure every applicable root-to-leaf instruction chain before and after
   compression.
5. Run agent-context tests/validation, link checks, diff hygiene, and exact
   CI on the final head.

## Starting findings

| Area | Current evidence | Initial classification |
| --- | --- | --- |
| Vercel deployment policy | Wave 00 accepted fail-closed repository policy and exact non-main API smoke show `Canceled by Ignored Build Step`; current living deployment docs still contain the old blocked wording and old feature SHA | Stale living claim |
| Runner preview readiness | `EGA_RUNNER_REQUIRE_VERCEL_PREVIEW=false` is the accepted default; current delivery docs describe that correctly but retain stale adjacent Wave 00 blocker text | Reconcile current guidance only |
| Mobile delivery | `apps/mobile/eas.json`, checked-in mobile scripts, and Wave 06–12 evidence define current delivery/verification limits | Compare against living architecture text |
| API/feature surfaces | Wave 01 matrix and Waves 02–10 artifacts are current evidence; older prose may omit later routes/surfaces | Reconcile only proven current maps |
| Instruction-chain budget | `npm run test:agent-context` passes 29/29, but `npm run validate:agent-context` reports 10 budget errors: root 10,775 bytes; leaf chains 13,402–14,233 bytes against 6,000 | Governance debt; compress without weakening semantics |

## Baseline debt classification

The instruction-size failures predate this wave and are the explicit Wave 14
owner. The dependency-audit issues recorded by Wave 01 are separate upstream
toolchain debt; they are not silently waived or reclassified here.

## Acceptance criteria

- Every modified living statement records its prior wording, contradicting
  current evidence, corrected wording, and evidence source.
- Historical reports remain historical.
- Living deployment/Runner/API/feature/mobile/architecture/testing guidance
  matches checked-in current truth and labels unavailable runtime proof.
- Root and leaf instruction chains fit the configured 6,000-byte budget, or a
  concrete external configuration limitation is recorded without weakening
  the validator.
- Safety, authority, queue, identity, RLS, architecture, and merge/deploy
  boundaries remain explicit after compression.
- Required links and agent-context structural tests pass.
- Critical findings: 0; Important findings introduced by this wave: 0.
