# Public Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an accessible, email-confirmed public signup flow backed by the existing Supabase Auth and cross-subdomain session architecture.

**Architecture:** Add a dedicated `/signup` client form and server page, a pure allow-listed redirect helper, an SSR `/auth/confirm` route, and an optional Cloudflare Turnstile adapter. Keep the existing login implementation stable except for a signup navigation link; use route-scoped CSS to avoid a risky auth-shell rewrite during launch.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Supabase JS/SSR, Vitest 4, CSS Modules, Cloudflare Turnstile script API.

## Global Constraints

- Public email signup with confirmation required in production.
- Fields are name, email, and one password field; no confirm-password field.
- Password policy is 12–128 characters with no composition rules.
- Store `full_name` in Supabase user metadata.
- Never redirect to an unapproved external origin.
- Never render raw Supabase errors, tokens, keys, or confirmation parameters.
- Preserve existing login behavior and shared cookie configuration.
- CAPTCHA is optional in code and activated when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is configured.
- No public-schema migration or RLS change in this branch.

---

### Task 1: Shared auth redirect policy

**Files:**
- Create: `src/lib/auth/safe-redirect.ts`
- Create: `src/lib/auth/safe-redirect.test.ts`

**Interfaces:**
- Produces: `resolveSafeAuthDestination(raw: string | null | undefined, origin: string, fallback?: string): URL`.
- Produces: `toInternalDestination(url: URL, origin: string): string | null`.

- [ ] Write tests covering relative paths, EGA House hosts, localhost/loopback, malformed URLs, protocol-relative URLs, credentials, unsupported schemes, and foreign hosts.
- [ ] Implement the minimal pure allow-list helper.
- [ ] Run `npm test -- src/lib/auth/safe-redirect.test.ts`.

### Task 2: Signup validation contract

**Files:**
- Create: `src/app/signup/signup-validation.ts`
- Create: `src/app/signup/signup-validation.test.ts`

**Interfaces:**
- Produces: `validateSignupFields(input): SignupFieldErrors`.
- Produces normalized `fullName` and `email` helpers.

- [ ] Write failing tests for blank/overlong names, malformed emails, and passwords outside 12–128 characters.
- [ ] Implement deterministic validation and normalization.
- [ ] Run `npm test -- src/app/signup/signup-validation.test.ts`.

### Task 3: Turnstile adapter

**Files:**
- Create: `src/app/signup/TurnstileWidget.tsx`

**Interfaces:**
- Consumes: `siteKey`, `onToken`, and `resetSignal`.
- Produces: one managed Turnstile widget when configured and no network call during SSR.

- [ ] Add typed `window.turnstile` declarations.
- [ ] Load the official script once, render the widget, clear expired/error tokens, and reset after failed signup.
- [ ] Keep the widget optional when no public site key is configured.

### Task 4: Premium signup page and Supabase flow

**Files:**
- Create: `src/app/signup/page.tsx`
- Create: `src/app/signup/signup-form.tsx`
- Create: `src/app/signup/signup.module.css`
- Create: `src/app/signup/signup-form.test.tsx`

**Interfaces:**
- Consumes: existing browser/server Supabase clients, Tasks 1–3.
- Produces: `/signup` with idle, submitting, validation-error, confirmation-required, and immediate-session states.

- [ ] Write render tests for accessible labels, autocomplete values, password reveal, result-first copy, and no confirm-password field.
- [ ] Add server page metadata and redirect authenticated users to `/dashboard`.
- [ ] Build responsive premium UI using the existing yellow, forest-green, glass, radius, and spacing language.
- [ ] Call `supabase.auth.signUp` with normalized email, password, `full_name`, full `/auth/confirm?next=...` URL, and optional CAPTCHA token.
- [ ] On `data.session`, follow the safe destination immediately; otherwise render `Check your inbox` without implying active access.
- [ ] Map deployment, rate-limit, CAPTCHA, and generic signup errors to stable recovery messages.

### Task 5: SSR email-confirmation route

**Files:**
- Create: `src/app/auth/confirm/route.ts`

**Interfaces:**
- Consumes: `token_hash`, Supabase `EmailOtpType`, shared safe redirect helper, server Supabase client.
- Produces: a verified cookie session followed by a safe redirect.

- [ ] Validate required parameters and sanitize `next`.
- [ ] Call `verifyOtp({ token_hash, type })`.
- [ ] Redirect success to the safe destination and failures to `/login?error=confirmation_failed` without secret parameters.

### Task 6: Login discovery and launch contract

**Files:**
- Modify: `src/app/login/login-form.tsx`
- Modify: `src/app/login/page.tsx`

**Interfaces:**
- Produces: a visible route from login to signup while preserving sign-in behavior.

- [ ] Add `Create an account` navigation with a preserved safe `next` query.
- [ ] Display a clear confirmation-failure message when `error=confirmation_failed`.
- [ ] Do not alter existing password sign-in or cross-domain redirect behavior.

### Task 7: Verification and integration

**Files:**
- Verify all changed production, test, design, and plan files.

- [ ] Run focused Vitest suites for redirect, validation, and signup rendering.
- [ ] Run full `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` through available CI/preview checks.
- [ ] Confirm exact-head Vercel preview is `READY`.
- [ ] Inspect diff against `main`, review security-sensitive redirects and auth payloads, open PR, and merge only with the head SHA locked.
