# Wave 15 — Independent Review

Status: ACCEPTED

## Dependency / exact starting point

- Previous accepted wave: Wave 14
- Previous accepted HEAD: `74b18408f5fb9b372a8243fdd2081a839a19391b`
- Original program base: `4473eee3bf0337d190d60d5a3d170a881a642338`
- Review scope: cumulative program changes from the original base, with the
  wave-local range recorded separately in PR #225.

## Review perspectives

- Architecture and dependency direction
- Security, actor derivation, RLS, and privileged clients
- Hono/server transport correctness
- Web behavior, discoverability, and UI states
- Mobile API boundary, state, navigation, and runtime safety
- Cross-platform product semantics
- Performance and accessibility
- Complexity and overengineering

## Important finding and repair

Fresh review found one program-introduced Important finding in the Inbox path:

1. `packages/data-access/src/inbox/repository.ts` returned the full matching
   owner history with no explicit row cap.
2. The mobile Inbox rendered every returned item eagerly through `ScrollView`
   plus `items.map()`.

Together those behaviors allowed Inbox growth to expand database results,
response payloads, and mounted React Native work without a V1 bound.

The repair intentionally did **not** introduce a pagination protocol during an
independent-review wave. The existing array contract remains intact while the
V1 read path is bounded to 240 newest matching Inbox rows and the mobile surface
uses `FlatList` virtualization.

### RED → GREEN evidence

#### Data-access bound

- RED commit: `ca0e3a1419122fab09826481967e7ab0f262217b`
- Unified run: `33822572282`
- Result: data-access typecheck passed and the new regression failed exactly
  because the Inbox query had no explicit row cap (94/95 tests passed).
- Production fix: `f4b4f2fa5ac5b8e87e07ce67b1d812e5f86f5298`
- Existing fake-query builders were updated only to support the now-real
  `.limit()` chain in commits `0bc6a2fd25165840433ded0abc416feb377ab63b`
  and `fca4e49efe5bd76f270269dcc353d60f78921216`.
- GREEN run: `33822923736`
- Result: data-access and server suites passed together with workspace,
  architecture/security, contracts, domain, application, API-client, mobile
  typecheck/tests, regressions, lint, delivery-map, and DB invariants available
  at that exact head.

#### Mobile virtualization

- RED commit: `398594fd9a5afe1ec7a9556854cc549841656ee6`
- Unified run: `33823048868`
- Result: the new virtualization regression failed while the pre-existing 263
  mobile tests passed; the failure proved the screen still used `ScrollView`
  and eager item mapping.
- Production fix: `72b381192f52e13781dc866d56ea05f44487b9cb`
- Unified run: `33823244773`
- Result at the fix head: data-access, server, contracts, domain, application,
  API-client, mobile Doctor/typecheck/tests/Android bundle, delivery-map,
  DB-invariants, lint, regressions, and web typecheck/tests/build passed.
  The workspace dependency-audit step remained slow at the time this acceptance
  record was written; the same cumulative dependency state had already passed
  the workspace gate at `fca4e49e` and no dependency file changed afterward.

## Architecture / product re-review

The Important repair preserves the existing architecture:

- Inbox ownership remains actor-derived and RLS-scoped.
- The cap lives in the persistence adapter rather than Hono or mobile policy.
- The mobile client still consumes the canonical API-client/contracts path.
- No alternate Inbox DTO, pagination authority, state store, or backend was
  introduced.
- Existing mobile Inbox actions, capture/edit/convert sheets, refresh behavior,
  empty state, view filters, and task destination navigation remain present.

The change is deliberately narrow: bound the V1 result and virtualize rendering.

## Remaining review findings

The fresh review also recorded non-blocking Minor or pre-existing debt:

- the visual archived state is not included in the TaskCard accessible name;
- a historical responsiveness/benchmark comment does not carry checked-in
  benchmark evidence;
- route-ownership prose contains a minor contradiction;
- a Wave 14 ledger reference points at an intermediate evaluation head;
- another duration helper and some ambiguous mobile controls pre-date this
  Wave 15 repair.

These findings do not invalidate the Wave 15 acceptance contract, which requires
zero unresolved Critical findings and zero unresolved program-introduced
Important findings. They remain explicit rather than being hidden in unrelated
refactoring.

## Acceptance record

| Gate | Result | Evidence |
| --- | --- | --- |
| Code | PASS | RED/GREEN regressions; affected data-access/server/mobile and cumulative checks passed |
| Runtime | NOT VERIFIED | Authenticated browser, emulator, and physical-device evidence remain unavailable; Hono health evidence exists from prior waves |
| Product | PASS | Inbox remains semantically identical while reads are bounded and mobile rendering virtualized |
| Review | PASS | Program-introduced Important Inbox finding repaired; Critical=0, Important=0 after re-review |
| Publication | PASS | PR #225 remains Draft; no merge, production deployment, or production DB mutation |

## Current-main integration note

`main` advanced during the program to `7a96be0dcd2292570d6a9070ab8865f1e19dc1b6`
with archived-project purge work. PR #225 therefore requires current-main
reconciliation before release-readiness can be claimed. That is a Wave 16
integration concern, not an unresolved Wave 15 review finding.

## Known inherited runtime gaps

- Authenticated browser proof: `RUNTIME NOT VERIFIED`.
- Android emulator runtime: `RUNTIME NOT VERIFIED`.
- Physical Android device: `RUNTIME NOT VERIFIED`.
- Authenticated Hono production connectivity: `RUNTIME NOT VERIFIED`.
- Hono health connectivity: `RUNTIME VERIFIED` from prior-wave evidence.

Historical wave reports retain their original point-in-time claims.
