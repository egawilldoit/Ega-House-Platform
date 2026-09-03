# Wave 12 — Accessibility and Interaction Quality

Status: ACCEPTED — EXTERNAL EVIDENCE NOT AVAILABLE

## Boundary

- Branch: `wave/12-accessibility`
- Starting accepted HEAD: `1e35387b577eaa352d41706666ff9b55418bc88d`
- Previous wave: Wave 11 performance
- Scope: core web and mobile interaction semantics, keyboard/focus behavior,
  reduced motion, non-color state communication, and native touch targets
- No authentication, production database, or production deployment changes

## Starting evidence

The existing codebase already provides strong baseline coverage:

- Web `:focus-visible` styling is defined in `apps/web/src/app/globals.css`;
  editorial shell and auth surfaces provide their own visible focus treatment.
- Web reduced-motion rules exist in the global motion stylesheet, editorial
  shell, home, dashboard, and auth styles.
- Web shell navigation, command palette, dialogs, forms, notifications, and
  review controls use semantic links/buttons, labels, dialog names, and live
  regions in the inspected paths.
- Mobile shared `Button`, `IconButton`, `FormField`, `FeedbackBanner`, and
  bottom navigation primitives expose roles, labels, state, live regions, and
  minimum touch-target tokens.
- Existing mobile accessibility suites cover buttons, selected controls, card
  actions, contrast tokens, reduced motion, Inbox capture, Friction, Today
  insight links, and the Wave 09 Weekly Review controls.

## Initial findings

The audit found a real consistency gap in secondary mobile interactions:

- notification list rows are actionable `Pressable` controls without an
  explicit button role, accessible name, unread state, or action hint;
- profile notification navigation is actionable but has no accessible name;
- notification settings `Open settings` and `Refresh status` controls rely on
  visible text without an explicit role/hint;
- task reminder date/history controls are actionable but omit accessible names
  and expanded state;
- the native root error recovery controls expose a role but not a stable
  accessible name/state contract.

These are presentation-layer defects. The underlying notification, profile,
reminder, auth, and update behavior remains owned by the existing routes and
queries; this wave will not alter those boundaries.

## Evidence plan

1. Add focused rendered-tree regressions for the affected controls.
2. Confirm the new assertions fail at this starting head.
3. Add explicit labels, hints, selected/expanded/busy state, and live-region
   semantics with the smallest local changes.
4. Run focused mobile accessibility tests, the affected mobile suite, mobile
   typecheck, Doctor, Android bundle validation, and exact-head CI.
5. Run a local web semantic/focus/reduced-motion review and affected web tests.
6. Report authenticated browser and Android assistive-technology execution as
   `RUNTIME NOT VERIFIED` unless the required external runtime is available.

## Acceptance criteria

- Primary web actions remain semantic, keyboard reachable, and visibly focused.
- Core web dialogs have an accessible name and recoverable Escape behavior.
- Important mobile actions have explicit meaningful labels where visible text
  or icon-only presentation is ambiguous.
- Mobile selected, expanded, disabled, busy, and error states are exposed to
  assistive technology where applicable.
- Critical state does not rely on color alone.
- Existing reduced-motion behavior is preserved.
- No core capability, navigation destination, API contract, or auth boundary
  is removed or duplicated.
- Focused and affected tests, typechecks, architecture/security/purity checks,
  and the applicable runtime ladder pass.
- Critical findings: 0; Important findings introduced by this wave: 0.
- Exact head, wave-local diff, PR evidence, and all unavailable runtime proof
  are recorded before acceptance.

## Runtime status

At audit start, authenticated web interaction and Android app execution are
not available in this environment. Existing accepted evidence proves mobile
L1–L5 and a direct deployed Hono health request; L6/L7 and authenticated
browser/mobile workflows remain `RUNTIME NOT VERIFIED` until those external
dependencies are available.

## Known baseline failures

- Any instruction-chain byte-budget findings recorded by Wave 01 predate this
  wave and are not attributed to accessibility work.
- Wave 11 recorded a transient externally hung acceptance-ledger CI audit;
  its exact implementation head had a full green CI run.

## Implementation

The focused red/green regression work is recorded in `111750c8` and the
minimal production changes in `b5bbe7e5`:

- notification rows now expose a stable name, button role, action hint, and
  unread-aware wording;
- profile, notification settings, task reminder/schedule, and root recovery
  controls now expose explicit names, hints, and applicable busy/disabled,
  expanded, and selected state;
- the quick-task and analytics web Sheet containers now reference their
  visible titles as the accessible dialog name.

No workflow, navigation, API, authentication, persistence, or product-state
semantics changed.

## Verification

- Focused red/green tests: mobile notification accessibility `1/1`; web
  dialog semantics `15/15`; affected mobile profile/notification tests `4/4`.
- Full mobile suite: `46` suites and `263` tests passed.
- Full web suite: `166` files and `1,276` tests passed.
- Mobile and web typechecks passed.
- Architecture, architecture tests, purity, and security checks passed.
- Exact pushed-head Unified Platform Validation run `33816304149` passed all
  `16/16` jobs, including workspace, server, web, mobile, and delivery-map
  checks.
- Local Expo Doctor remains `17/18`: the pre-existing `@types/react`
  expected `~19.1.10`, found `19.2.14` mismatch is not introduced by this
  wave.
- Local web build and local Android export were not usable from this linked
  worktree: Next rejects the out-of-root dependency symlink, and Metro cannot
  resolve the current shared-contract package through that stale dependency
  tree. The exact-head CI build/bundle checks passed.
- `git diff --check` and the wave-local diff are clean after recording this
  ledger.

## Review

The exact wave-local range was reviewed for boundary, product, and complexity
regressions. Critical findings: `0`. Important findings introduced by this
wave: `0`. No second icon system, state owner, transport, or abstraction was
introduced.

## Final acceptance

Wave 12 is accepted at the exact current head only with external runtime
evidence explicitly unavailable. Existing evidence covers the supported L1-L5
mobile ladder and deployed Hono health; authenticated browser inspection,
Android app runtime, and assistive-technology execution remain `RUNTIME NOT
VERIFIED`. The Vercel status for the pushed head is successful with
`Canceled by Ignored Build Step`, so no non-main Preview was built.
