# Wave 14 — Living Documentation and Agent-Context Reconciliation

Status: ACCEPTED — EXTERNAL EVIDENCE NOT AVAILABLE

## Boundary

- Branch: `wave/14-doc-reconciliation`
- Starting accepted HEAD: `5a8ce8c04b899423aa8afe13b03ab67c850b9867`
  (Wave 13 merge #223 on `origin/main`). The historical wave-local range was
  reconstructed onto this base via replay; the pre-reconstruction tip
  `74b18408f5fb9b372a8243fdd2081a839a19391b` is preserved locally at
  `backup/wave14-pre-reconcile-74b18408` and all replayed files are
  byte-identical to it.
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

## Reconciled living statements

| Living file | Old statement | Contrary current evidence | Corrected statement | Evidence |
| --- | --- | --- | --- | --- |
| `docs/architecture/delivery-lifecycle.md` | Wave 00 remained blocked because the API project built a Preview for the feature branch SHA. | Wave 00 was accepted at `6f71ebdf6f67f8c77f371b28eefba4487a0930b8`; the exact non-main API status was `Canceled by Ignored Build Step`. | Repository policy and the observed API smoke enforce fail-closed non-main skipping; this does not prove every connected Vercel setting or a production deployment. | Wave 00 acceptance record, GitHub commit status for `6f71ebdf`, root and server `vercel.json`. |
| `docs/architecture/hono-deployment.md` | The standalone API deployment lock was still blocked by a successful Preview deployment. | The post-fix exact-SHA API status was canceled by the ignored build step and no successful Preview was observed. | Non-main API builds are skipped by the fail-closed ignore command; `main` remains permitted and production verification remains separate. | Wave 00 acceptance record and GitHub commit status for `6f71ebdf`. |
| `docs/architecture/platform-monorepo.md` | The current server/API surface listed only Auth, Timer, Projects, Goals, Tasks, and Today. | `apps/server/src/routes/` and route registration include Inbox, Notifications, Friction, Health, Operator, Time Context, and Weekly Review. | The current transport surface includes all listed route families, while application ownership remains below Hono. | Current server route files/registration and Wave 01 capability matrix. |
| `ARCHITECTURE.md` | Mobile delivery documentation described no checked-in EAS configuration. | `apps/mobile/eas.json` exists and contains minimal CLI metadata. | EAS metadata is checked in, but no EAS Build, Submit, or Update workflow is configured or claimed. | `apps/mobile/eas.json`, mobile scripts, and Wave 06 runtime evidence. |
| `docs/architecture/notifications.md` | Native notification setup was described as an unmerged branch state with no current EAS metadata. | The notification implementation is present on the current accepted branch and `apps/mobile/eas.json` exists; device migration and push delivery remain unverified. | The native layer is current in the repository, while device migration, push delivery, and release-service behavior remain explicitly NOT VERIFIED. | Current notification source, `apps/mobile/eas.json`, and Wave 06–12 evidence. |
| `docs/mobile-e2e-flows.md` | Login and task/project protocols referred to a Tasks tab and Projects tab. | The current tab layout exposes Today, Work, Goals, Timer, and Inbox; Tasks and Projects are modes within Work. | After login, Today is the default protected surface; task and project flows are reached through Work modes. | `apps/mobile/app/(app)/(tabs)/_layout.tsx`, Work route files, and current mobile navigation. |

Historical Wave 01–13 ledgers and reports were left unchanged. Their
point-in-time claims remain historical evidence rather than current product
guidance.

## Instruction-chain measurement

The validator was not weakened. Repetition was removed from the root contract
and subsystem-specific guidance was retained in the nearest leaf instructions.

| Chain | Before | After | Result |
| --- | ---: | ---: | --- |
| root | 10,775 bytes | 4,210 bytes | under 6,000 |
| web | 13,888 bytes | 5,716 bytes | under 6,000 |
| mobile | 13,433 bytes | 5,609 bytes | under 6,000 |
| server | 13,402 bytes | 5,504 bytes | under 6,000 |
| packages | 13,825 bytes | 5,803 bytes | under 6,000 |
| Runner | 14,233 bytes | 5,948 bytes | under 6,000 |

`npm run test:agent-context` passes 29/29 and
`npm run validate:agent-context` passes with navigation, links, commands,
queue, identity, RLS, architecture, and merge-safety checks intact.

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

## Acceptance record

- Evaluation head: `edd241d3` (content head; this acceptance record amends
  on top). Reconstructed-head gates observed: `test:agent-context` 29/29,
  `validate:agent-context` STRUCTURAL PASS (root 4,210; web 5,716; mobile
  5,609; server 5,504; packages 5,803; Runner 5,948 — all under 6,000),
  `check:architecture` PASS, `test:architecture` 21/21, `ci:purity` PASS,
  `ci:security` PASS, `ci:workspace` PASS, `git diff --check` PASS.
- Code gate: PASS — `test:agent-context`, `validate:agent-context`,
  `ci:workspace`, `ci:purity`, `ci:security`, architecture checks, and
  `git diff --check`.
- Runtime gate: NOT VERIFIED for authenticated browser/device behavior;
  this wave changed living guidance and agent instructions only. Existing
  Wave 00 external Vercel evidence remains recorded as an observed skipped
  non-main build.
- Product gate: PASS — current navigation, deployment, API-surface, and
  mobile-delivery guidance now points to observable repository evidence and
  preserves explicit NOT VERIFIED boundaries.
- Review gate: PASS — no Critical or Important issue introduced by this
  documentation-only wave.
- Publication gate: pending final push/CI confirmation; no production deploy,
  database mutation, or merge occurred.

Result: `ACCEPTED — EXTERNAL EVIDENCE NOT AVAILABLE`.
