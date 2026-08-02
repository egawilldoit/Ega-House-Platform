# Signup Discovery CTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `https://www.egawilldoit.online/signup` easy to reach from the login form and the two highest-intent homepage sections.

**Architecture:** Keep navigation server-owned where possible. Pass one canonical signup URL from the login page into the existing client login form, add two homepage `Link` CTAs, and extend the existing path-scoped signup CI with one focused source contract so future regressions are caught without introducing a new test framework.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Vitest 4, Tailwind utility classes, GitHub Actions.

## Global Constraints

- Canonical signup destination is exactly `https://www.egawilldoit.online/signup`.
- Preserve an encoded login `next` value on both login-page signup links.
- Keep sign-in and `Enter workspace` as the existing-user actions.
- Use descriptive link text and normal links for navigation.
- No modal, new dependency, tracking script, or auth behavior change.
- All changed code must pass focused tests, typecheck, scoped lint, and production build.

---

### Task 1: Signup discovery contract

**Files:**
- Create: `src/app/signup/signup-discovery.test.ts`

**Interfaces:**
- Consumes: repository source files for `src/app/login/page.tsx`, `src/app/login/login-form.tsx`, and `src/app/page.tsx`.
- Produces: a focused Vitest contract proving all approved discovery points use the canonical signup destination and retain existing sign-in navigation.

- [ ] **Step 1: Write the failing source contract**

Create a test that reads the three source files from `process.cwd()` and asserts:

```ts
expect(loginPage).toContain('https://www.egawilldoit.online/signup');
expect(loginPage).toContain('encodeURIComponent(nextParam)');
expect(loginForm).toContain('Create your account');
expect(homePage.match(/https:\/\/www\.egawilldoit\.online\/signup/g)).toHaveLength(2);
expect(homePage).toContain('Create account');
expect(homePage).toContain('Turn the workflow into your workspace.');
expect(homePage).toContain('Enter workspace');
expect(homePage).toContain('Sign in instead');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- --run src/app/signup/signup-discovery.test.ts
```

Expected: failure because the form-level and homepage CTAs do not yet exist and the login header still uses a relative URL.

### Task 2: Login signup discovery

**Files:**
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/login/login-form.tsx`

**Interfaces:**
- Consumes: optional `next` query from the login route.
- Produces: `LoginForm({ signupHref }: { signupHref: string })` and two login-page links using the same canonical destination.

- [ ] **Step 1: Build the canonical login signup URL**

In `src/app/login/page.tsx`, define the exact base URL and append encoded `next` only when present:

```ts
const PUBLIC_SIGNUP_URL = "https://www.egawilldoit.online/signup";
const signupHref = nextParam
  ? `${PUBLIC_SIGNUP_URL}?next=${encodeURIComponent(nextParam)}`
  : PUBLIC_SIGNUP_URL;
```

- [ ] **Step 2: Pass the URL into the existing form**

Change the render to:

```tsx
<LoginForm signupHref={signupHref} />
```

- [ ] **Step 3: Add the form-level secondary signup prompt**

Add a required prop to `LoginForm` and render below the sign-in form:

```tsx
<p className="ega-signup-prompt">
  New to EGA House? <Link href={signupHref}>Create your account</Link>
</p>
```

Add route-scoped styles for spacing, focus visibility, and the existing forest/red palette without changing sign-in behavior.

### Task 3: Homepage hero and How-it-works CTAs

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: the canonical absolute signup URL.
- Produces: one secondary hero CTA and one completion CTA following the four-step workflow.

- [ ] **Step 1: Add the hero secondary CTA**

Next to `Enter workspace`, add a secondary outlined link:

```tsx
<Link href="https://www.egawilldoit.online/signup">Create account</Link>
```

Keep the existing login action visually primary.

- [ ] **Step 2: Add the workflow completion panel**

After the four `How it works` steps, render:

```tsx
<p>Ready to start?</p>
<h2>Turn the workflow into your workspace.</h2>
<p>Create your EGA House account and move from goals to focused execution in one place.</p>
<Link href="https://www.egawilldoit.online/signup">Create your account</Link>
<Link href="/login?next=%2Fdashboard">Sign in instead</Link>
```

Use the existing yellow, teal, red, border, and glass treatment. Stack actions on narrow screens and keep visible focus styles.

- [ ] **Step 3: Run the focused test and verify GREEN**

Run:

```bash
npm test -- --run src/app/signup/signup-discovery.test.ts
```

Expected: all signup-discovery assertions pass.

### Task 4: Extend CI and verify

**Files:**
- Modify: `.github/workflows/public-signup-ci.yml`

**Interfaces:**
- Consumes: changes to `src/app/page.tsx`, both login files, and the new discovery test.
- Produces: automatic test, typecheck, lint, and build coverage for signup discovery changes.

- [ ] **Step 1: Expand path triggers and focused tests**

Add:

```yaml
- "src/app/page.tsx"
- "src/app/login/login-form.tsx"
```

Add `src/app/signup/signup-discovery.test.ts` to the focused test command and add `src/app/page.tsx` plus `src/app/login/login-form.tsx` to scoped ESLint.

- [ ] **Step 2: Open a PR and run exact-head validation**

Required gates:

```text
Focused signup/auth tests: pass
TypeScript: pass
Scoped ESLint: pass
Production Next.js build: pass
Unresolved review threads: 0
PR mergeable: true
```

- [ ] **Step 3: Merge with expected head SHA**

Use a squash merge and supply the verified exact head SHA so GitHub rejects the merge if the branch moves.
