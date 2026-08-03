# Homepage and Auth Editorial Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the operational-studies homepage for stronger presentation at normal zoom and redesign login and signup as a complementary Black Signal / Signal Cream auth pair without changing authentication behavior.

**Architecture:** Keep the existing homepage section architecture and Motion dependency. Add a shared `src/app/auth-ui/**` presentation layer for auth-only layout, geometry, motion, fields, feedback, and tokens; login and signup retain their existing Supabase calls, redirects, validation, Turnstile integration, and success logic. Visual changes remain route-scoped and do not alter dashboard or backend code.

**Tech Stack:** Next.js 16.2.12, React 19.2.4, TypeScript 5, Motion 12.42.2, CSS modules/route-scoped CSS, Lucide React, Vitest 4.1.5, Supabase Auth.

## Global Constraints

- Work only on `feat/homepage-operational-studies` and PR #117.
- Preserve authenticated redirects from `/login` and `/signup` to `/dashboard`.
- Preserve login safe `next` destination behavior.
- Preserve signup confirmation destination behavior, Supabase metadata, Turnstile, validation, focus management, and confirmation-success behavior.
- Keep browser-native scrolling authoritative; do not add Lenis, GSAP, Three.js, or another animation engine.
- Use the existing Motion dependency for bounded entry and geometry effects.
- Respect `prefers-reduced-motion`; content must remain usable without animation.
- Keep all public signup and login URLs canonical.
- No backend, database, dashboard, provider, or password-reset changes.

---

## File Map

### Create

- `src/app/auth-ui/auth-shell.tsx` — shared auth document frame and theme selection.
- `src/app/auth-ui/auth-header.tsx` — fixed editorial auth header.
- `src/app/auth-ui/auth-study-label.tsx` — numbered study metadata row.
- `src/app/auth-ui/auth-geometry.tsx` — decorative signal/orbit geometry.
- `src/app/auth-ui/auth-motion.tsx` — MotionConfig and bounded reveal primitives.
- `src/app/auth-ui/auth-field.tsx` — shared field wrapper with label, help, error, and trailing control slots.
- `src/app/auth-ui/auth-submit.tsx` — shared square editorial submit button.
- `src/app/auth-ui/auth-feedback.tsx` — shared alert/status presentation.
- `src/app/auth-ui/auth.css` — shared auth tokens, responsive layout, themes, focus, and reduced-motion rules.
- `src/app/auth-ui/auth-ui.test.ts` — structural regression test for shared auth presentation.

### Modify

- `src/app/login/page.tsx` — compose Black Signal auth shell and preserve redirect/signup-link behavior.
- `src/app/login/login-form.tsx` — retain auth logic; replace embedded unrelated design system with shared auth presentation.
- `src/app/login/__tests__/navigation-regression.test.tsx` — preserve navigation contracts and add structural assertions where appropriate.
- `src/app/signup/page.tsx` — compose Signal Cream auth shell and loading fallback.
- `src/app/signup/signup-form.tsx` — retain signup/Turnstile logic; use shared auth presentation.
- `src/app/signup/signup.module.css` — remove obsolete glass-marketing system; keep only signup-specific layout/state rules if needed.
- `src/app/signup/signup-form.test.ts` — assert shared auth integration and preserved security/success states.
- `src/app/home/home.css` — refine scale, vertical rhythm, wide-screen composition, tablet/mobile breakpoints, and reveal polish.
- `src/app/home/components/home-motion.tsx` — refine bounded reveal sequencing without scroll hijacking.
- `src/app/home/home-page.test.ts` — add regression assertions for normal-zoom composition tokens and reduced-motion behavior.
- `.github/workflows/public-signup-ci.yml` — include shared auth UI tests and lint paths.
- `docs/implementation/2026-08-03-homepage-operational-studies-evidence.md` — append exact-head verification evidence.

---

### Task 1: Shared auth presentation system

**Files:**
- Create: `src/app/auth-ui/auth-shell.tsx`
- Create: `src/app/auth-ui/auth-header.tsx`
- Create: `src/app/auth-ui/auth-study-label.tsx`
- Create: `src/app/auth-ui/auth-geometry.tsx`
- Create: `src/app/auth-ui/auth-motion.tsx`
- Create: `src/app/auth-ui/auth-field.tsx`
- Create: `src/app/auth-ui/auth-submit.tsx`
- Create: `src/app/auth-ui/auth-feedback.tsx`
- Create: `src/app/auth-ui/auth.css`
- Test: `src/app/auth-ui/auth-ui.test.ts`

**Interfaces:**
- Produces: `AuthShell`, `AuthHeader`, `AuthStudyLabel`, `AuthGeometry`, `AuthReveal`, `AuthField`, `AuthSubmit`, `AuthFeedback`.
- `AuthShell` props: `{ theme: "black-signal" | "signal-cream"; children: ReactNode }`.
- `AuthHeader` props: `{ status: string; actionHref: string; actionLabel: string }`.
- `AuthField` props: `{ id: string; label: string; help?: ReactNode; error?: ReactNode; trailing?: ReactNode; children: ReactNode }`.
- `AuthSubmit` props extend `ButtonHTMLAttributes<HTMLButtonElement>` and accept `loadingLabel`.

- [ ] **Step 1: Write the failing structural test**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("shared auth editorial system", () => {
  it("defines both approved auth themes and reduced motion", () => {
    const css = read("src/app/auth-ui/auth.css");
    expect(css).toContain('[data-auth-theme="black-signal"]');
    expect(css).toContain('[data-auth-theme="signal-cream"]');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("provides shared shell, header, geometry, field, submit, and feedback units", () => {
    for (const file of [
      "auth-shell.tsx",
      "auth-header.tsx",
      "auth-geometry.tsx",
      "auth-field.tsx",
      "auth-submit.tsx",
      "auth-feedback.tsx",
    ]) {
      expect(read(`src/app/auth-ui/${file}`).length).toBeGreaterThan(80);
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
npm test -- --run src/app/auth-ui/auth-ui.test.ts
```

Expected: FAIL because `src/app/auth-ui/**` does not exist.

- [ ] **Step 3: Implement the shared components**

Use semantic wrappers and import `./auth.css` from `auth-shell.tsx`. `AuthMotion` must use:

```tsx
<MotionConfig reducedMotion="user">{children}</MotionConfig>
```

`AuthReveal` must default to a short opacity/translate transition and render content without depending on scroll state.

- [ ] **Step 4: Implement shared auth CSS**

Define the shared token set:

```css
.auth-root {
  --auth-ink: #11110f;
  --auth-paper: #fff9ed;
  --auth-cream: #f4efe3;
  --auth-signal: #ff4b2b;
  --auth-citrus: #ffd400;
  --auth-blue: #174e9f;
  --auth-header-height: 76px;
}
```

Provide fixed editorial header, visible grid, responsive two-column shell, square 1px-bordered fields/buttons, strong focus rings, mobile stacking, and reduced-motion overrides.

- [ ] **Step 5: Run the focused test**

```bash
npm test -- --run src/app/auth-ui/auth-ui.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/auth-ui
git commit -m "feat: add shared editorial auth system"
```

---

### Task 2: Redesign login as Black Signal

**Files:**
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/login/login-form.tsx`
- Test: `src/app/login/login-form.test.ts`
- Test: `src/app/login/__tests__/navigation-regression.test.tsx`

**Interfaces:**
- Consumes: shared auth components from Task 1.
- Preserves: `getSafeRedirect`, `supabase.auth.signInWithPassword`, `router.replace`, `router.refresh`, and cross-origin `window.location.assign` behavior.

- [ ] **Step 1: Add failing login presentation assertions**

Add assertions that login imports `AuthShell`, uses `theme="black-signal"`, contains `AUTH 01 / SIGN IN`, and retains the canonical create-account link and safe redirect logic.

- [ ] **Step 2: Run login tests and confirm RED**

```bash
npm test -- --run src/app/login/login-form.test.ts src/app/login/__tests__/navigation-regression.test.tsx
```

Expected: presentation assertions fail while navigation assertions remain green.

- [ ] **Step 3: Refactor `page.tsx` into the shared shell**

Keep server-side user lookup and redirect unchanged. Render:

```tsx
<AuthShell theme="black-signal">
  <AuthHeader status="AUTH / SIGN IN" actionHref={signupHref} actionLabel="Create account" />
  <LoginForm signupHref={signupHref} />
</AuthShell>
```

The confirmation-failed alert remains `role="alert"` and visually uses `AuthFeedback`.

- [ ] **Step 4: Replace the embedded login design system**

Remove the large inline `<style>` block. Keep all existing state and submit logic. Use:

- `AuthStudyLabel` with `AUTH 01`, `SIGN IN`, `BLACK SIGNAL`;
- headline `Return to the system.`;
- bounded `AuthGeometry` and `AuthReveal`;
- `AuthField` for email/password;
- `AuthSubmit` for pending and normal states;
- accessible password reveal control;
- visible link to signup.

- [ ] **Step 5: Run login tests**

```bash
npm test -- --run src/app/login/login-form.test.ts src/app/login/__tests__/navigation-regression.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/login src/app/auth-ui
git commit -m "feat: redesign login as black signal"
```

---

### Task 3: Redesign signup as Signal Cream

**Files:**
- Modify: `src/app/signup/page.tsx`
- Modify: `src/app/signup/signup-form.tsx`
- Modify: `src/app/signup/signup.module.css`
- Test: `src/app/signup/signup-form.test.ts`
- Test: `src/app/signup/signup-validation.test.ts`
- Test: `src/app/signup/signup-discovery.test.ts`

**Interfaces:**
- Consumes: shared auth components from Task 1.
- Preserves: `validateSignupFields`, `resolveSafeAuthDestination`, `supabase.auth.signUp`, `full_name`, `emailRedirectTo`, optional `captchaToken`, focus-first-error behavior, and confirmation-success state.

- [ ] **Step 1: Add failing signup presentation assertions**

Update the UI contract test to assert `AuthShell`, `signal-cream`, `AUTH 02 / CREATE`, `Build your control room.`, shared field/submit usage, and unchanged Turnstile and confirmation copy.

- [ ] **Step 2: Run signup tests and confirm RED**

```bash
npm test -- --run src/app/signup/signup-form.test.ts src/app/signup/signup-validation.test.ts src/app/signup/signup-discovery.test.ts
```

Expected: new presentation assertions fail; validation and discovery remain green.

- [ ] **Step 3: Refactor the signup page and fallback**

Keep server-side user lookup and redirect unchanged. Use the shared Signal Cream shell/header in both normal and Suspense fallback paths.

- [ ] **Step 4: Replace glass cards with editorial structure**

Retain all form state and handlers. Present the three benefits as numbered operational notes, integrate the form into structural grid lines, and render trust/security information as metadata rows. Use `AuthField`, `AuthSubmit`, and `AuthFeedback` without changing field IDs, autocomplete values, `aria-invalid`, `aria-describedby`, Turnstile, or success-state controls.

- [ ] **Step 5: Reduce `signup.module.css` to signup-specific rules**

Keep only styles not owned by shared auth CSS: confirmation-state alignment, Turnstile containment, signup benefit list, and any form-specific responsive details.

- [ ] **Step 6: Run signup tests**

```bash
npm test -- --run src/app/signup/signup-form.test.ts src/app/signup/signup-validation.test.ts src/app/signup/signup-discovery.test.ts src/app/auth/confirm/route.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/signup src/app/auth-ui
git commit -m "feat: redesign signup as signal cream"
```

---

### Task 4: Refine homepage presentation and motion

**Files:**
- Modify: `src/app/home/home.css`
- Modify: `src/app/home/components/home-motion.tsx`
- Modify: `src/app/home/home-page.test.ts`

**Interfaces:**
- Preserves: six stable section IDs, active-section header, scroll progress, native scrolling, approved themes, and reduced-motion path.

- [ ] **Step 1: Add failing polish assertions**

Assert the CSS contains explicit wide-screen and normal-zoom safeguards:

```ts
expect(styles).toContain("--home-content-max");
expect(styles).toContain("@media (min-width: 1680px)");
expect(styles).toContain("@media (max-width: 1180px)");
expect(styles).toContain("text-wrap: balance");
```

Also assert Motion remains bounded and no Lenis/GSAP is introduced.

- [ ] **Step 2: Run the homepage test and confirm RED**

```bash
npm test -- --run src/app/home/home-page.test.ts
```

Expected: FAIL on the new polish assertions.

- [ ] **Step 3: Refine desktop composition**

Add `--home-content-max`, safer heading clamps, `text-wrap: balance`, improved top spacing below the fixed header, consistent section label margins, stronger wide-screen max-widths, and board dimensions that remain visually balanced at 100% zoom.

- [ ] **Step 4: Refine tablet/mobile composition**

Collapse complex grids by 1180px, reduce decorative geometry, prevent horizontal overflow, keep CTAs fully visible, and preserve reading order. Do not force scroll snapping.

- [ ] **Step 5: Refine reveal sequencing**

Keep `MotionConfig reducedMotion="user"`; use short, bounded opacity/translate reveals. Avoid long delays and any transform that hides interactive controls after mount.

- [ ] **Step 6: Run homepage tests**

```bash
npm test -- --run src/app/home/home-page.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/home
git commit -m "refactor: polish operational studies presentation"
```

---

### Task 5: CI, full verification, and evidence

**Files:**
- Modify: `.github/workflows/public-signup-ci.yml`
- Modify: `docs/implementation/2026-08-03-homepage-operational-studies-evidence.md`
- Modify: PR #117 description

**Interfaces:**
- Consumes all prior tasks.
- Produces exact-head evidence for merge review.

- [ ] **Step 1: Extend focused CI**

Include:

```bash
npm test -- --run \
  src/app/auth-ui/auth-ui.test.ts \
  src/app/home/home-page.test.ts \
  src/app/login/login-form.test.ts \
  src/app/login/__tests__/navigation-regression.test.tsx \
  src/app/signup/signup-form.test.ts \
  src/app/signup/signup-validation.test.ts \
  src/app/signup/signup-discovery.test.ts \
  src/app/auth/confirm/route.test.ts
```

Add `src/app/auth-ui` to scoped ESLint paths.

- [ ] **Step 2: Run focused tests**

```bash
npm test -- --run src/app/auth-ui/auth-ui.test.ts src/app/home/home-page.test.ts src/app/login/login-form.test.ts src/app/login/__tests__/navigation-regression.test.tsx src/app/signup/signup-form.test.ts src/app/signup/signup-validation.test.ts src/app/signup/signup-discovery.test.ts src/app/auth/confirm/route.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run complete repository tests**

```bash
npm test
```

Expected: all test files and tests pass.

- [ ] **Step 4: Run static and production gates**

```bash
npm run typecheck
npx eslint src/app/auth-ui src/app/home src/app/login src/app/signup src/app/page.tsx src/app/auth/confirm
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Confirm MCP Integration CI**

Verify the PR-head MCP workflow concludes `success` and no auth presentation change altered MCP production behavior.

- [ ] **Step 6: Record evidence**

Append the exact head SHA, focused-test count, full-suite count, typecheck, ESLint, build, MCP workflow, unresolved review threads, and preview deployment status to the implementation evidence document and PR body.

- [ ] **Step 7: Final visual gate**

Review homepage, login, and signup at:

- 1920×1080, 1440×900, 1280×800;
- tablet and narrow mobile;
- 100%, 90%, and 80% browser zoom;
- keyboard-only navigation;
- reduced-motion mode;
- login error/loading;
- signup validation/loading/confirmation success.

- [ ] **Step 8: Commit final evidence**

```bash
git add .github/workflows/public-signup-ci.yml docs/implementation/2026-08-03-homepage-operational-studies-evidence.md
git commit -m "test: certify homepage and auth editorial refinement"
```
