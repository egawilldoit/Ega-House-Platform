# Wave 07 — Mobile API and Runtime Repair

Date: 2026-09-04 UTC
Branch: `wave/07-mobile-runtime-repair`
Starting accepted HEAD: `207c489d754eef6595cce9c766140d50cd82d118` (Wave 06 merge PR #215 on current main; rebuilt from historical repair, no stale stacked history)
Scope: repair proven mobile API/runtime defects from the Wave 06 ledger.

## Reproduction and trace

The defect was reproduced at the mobile refresh boundary:

```text
surface: apps/mobile/lib/api/client.ts
steps: configure a stored session; return HTTP 200 with `{ ok: true }` from `/api/auth/refresh`; run `refreshMobileSessionIfConfigured()`
expected: return false and preserve the existing session because the response has no usable session payload
actual: the old implementation treated the response as a typed value and attempted to install an invalid session
```

Trace:

```text
authenticated mobile request
→ mobileApiFetch
→ refreshMobileSessionIfConfigured
→ `/api/auth/refresh`
→ unvalidated JSON response
→ session handler
```

Hypothesis: the refresh path can corrupt in-memory and durable session state because `mobileApiFetch<T>` provides a compile-time cast, not a runtime contract check, before `performRefresh` calls `setSession`.

## Minimal repair

- Added runtime guards for the shared mobile login and refresh response contracts.
- Validated the refresh response before session installation.
- Validated the login response before returning it to `AuthProvider`.
- Preserved the existing single-flight, terminal-auth cleanup, transient-failure, and session-identity race behavior.
- Wave 06's merged evidence doc on current main already covers its own audit SHAs; this repair does not re-edit it.

## Evidence

Historical evidence below was recorded on the pre-rebuild stacked head; rebuild verification on base `207c489d` follows in the next section.

- The new mobile regression was RED on the pre-fix implementation: 11 tests passed and the malformed-refresh test received `true`.
- The focused refresh suite is GREEN: 12/12 tests.
- Contract guard tests are GREEN: 24/24 contract tests.
- Mobile typecheck is GREEN.
- Full mobile suite is GREEN: 38 suites, 239 tests.
- The malformed-refresh regression also proves the pre-existing session is
  unchanged; no cleanup or unauthorized callback runs for a malformed success.
- Independent review completed with Critical: 0 and Important: 0. The review's
  remaining Minor note is recorded as non-blocking: login validation is covered
  by the shared guard and mobile auth boundary, while the refresh path has the
  end-to-end session-state regression.
- Android emulator/physical-device retest is `NOT VERIFIED`; Wave 06 found no adb target or local APK. The local verification ladder remains the highest available code/bundle evidence, not app-runtime proof.

## Acceptance status

`P0/P1 functional repair: PASS`
`Code gate: PASS`
`Runtime gate: NOT VERIFIED — no Android target is available`
`Product gate: PASS for the repaired response-state contract; authenticated Android product flow NOT VERIFIED`
`Review gate: PASS — Critical 0, Important 0; one non-blocking Minor recorded above`
`Publication gate: PENDING — re-verified below on the rebuilt head; no non-main Vercel deployment was created`
`Accepted ending HEAD: PENDING — set after verification`
`Result: PENDING VERIFICATION`
