# Homepage and Auth Editorial Refinement — Implementation Evidence

**Date:** 2026-08-03  
**Branch:** `feat/homepage-operational-studies`  
**Pull request:** `#117`  
**Verified implementation head:** `6e760faa81c1e31d7f8be6de36d4441d4f6fa416`

## Delivered scope

### Homepage

- Retained the six connected operational studies: Introduction, Goals, Planning, Focus, Review, and Workspace.
- Added a route-scoped presentation-polish layer for stronger composition at normal browser zoom.
- Rebalanced wide-screen content widths, display-type scale, section rhythm, board dimensions, and CTA presentation.
- Added explicit 1680px wide-screen and 1180px tablet-collapse behavior.
- Improved long-copy wrapping and protected layouts from horizontal overflow.
- Kept browser-native scrolling, active-study tracking, page progress, and reduced-motion behavior authoritative.

### Shared auth presentation

- Added `src/app/auth-ui/**` as a shared editorial presentation boundary.
- Added reusable shell, header, study label, geometry, Motion wrapper, field, submit, and feedback components.
- Added shared color, spacing, grid, focus, responsive, and reduced-motion rules.
- Used the existing Motion dependency only; no additional animation or scroll engine was introduced.

### Login — Black Signal

- Redesigned `/login` as a dark Black Signal study with cream typography, citrus focus geometry, and signal-red accents.
- Preserved Supabase email/password authentication.
- Preserved safe `next` destination handling, same-origin router replacement, external approved-origin navigation, and authenticated `/dashboard` redirect.
- Preserved password visibility controls, pending state, errors, and the canonical public signup destination.

### Signup — Signal Cream

- Redesigned `/signup` as a cream/red editorial study with restrained blue orbital geometry.
- Preserved field validation, first-error focus, password guidance, Turnstile, Supabase metadata, confirmation URL construction, and safe post-auth navigation.
- Preserved the email-confirmation success state and account-restart controls.
- Replaced the prior unrelated glass-card styling with the shared auth grid and structural form system.

## TDD evidence

### Shared auth RED

Public Signup CI run `30831212801` failed at the focused test step because the planned `src/app/auth-ui/**` modules and approved auth themes did not exist. Existing login, signup, redirect, and homepage behavior tests remained green.

### Homepage polish RED

Public Signup CI run `30831945562` failed on the newly defined normal-zoom and wide-screen presentation contract before `--home-content-max`, the 1680px/1180px breakpoints, balanced headings, and overflow wrapping were implemented.

## GREEN evidence

Public Signup CI run `30832751992` passed on verified implementation head `6e760faa81c1e31d7f8be6de36d4441d4f6fa416`.

Successful gates:

- exact dependency installation;
- focused public-surface suite: **9 files, 63 tests passed**;
- complete repository suite: **132 files, 961 tests passed**;
- TypeScript typecheck;
- scoped ESLint execution;
- production Next.js build.

MCP Integration CI run `30832748349` passed on the same implementation head.

GitHub code-quality review identified one unused login import. Commit `6e760faa81c1e31d7f8be6de36d4441d4f6fa416` removed it, and the review thread was resolved.

## Preview status

Vercel currently exposes a READY branch preview for commit `8bf9de22787a6721fff61eff8a1cf1902976b066`, which contains the earlier homepage implementation but not this final auth/refinement head. No deployment for `6e760faa81c1e31d7f8be6de36d4441d4f6fa416` was available during verification.

## Remaining human gate

Before merge, generate or receive a fresh Vercel preview for the verified implementation head and inspect:

- homepage at 1920×1080, 1440×900, 1280×800, tablet, and narrow mobile;
- login and signup at desktop and narrow mobile;
- 100%, 90%, and 80% browser zoom;
- keyboard-only navigation;
- reduced-motion mode;
- login error/loading states;
- signup validation/loading/confirmation-success states.

No production deployment or merge is authorized by this evidence document.
