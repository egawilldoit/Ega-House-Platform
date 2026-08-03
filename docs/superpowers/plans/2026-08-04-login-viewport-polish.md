# Login Viewport Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Black Signal login surface fully legible and usable in a normal desktop viewport without changing authentication behavior or the approved visual direction, then merge PR #117 after verification.

**Architecture:** Keep the existing shared auth components and route structure. Add a regression contract for the desktop viewport layout, then correct only the login-specific sizing and vertical-flow rules in `auth.css`. Preserve the fixed header, grid, geometry, form logic, safe redirects, and signup theme.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS, Vitest, GitHub Actions, Vercel.

## Global Constraints

- Work only on `feat/homepage-operational-studies`.
- Preserve the Black Signal login theme and all existing auth behavior.
- Reuse existing auth tokens; introduce no new colors, fonts, or dependencies.
- At approximately 1919×1000, the full story headline, lead, email/password inputs, submit button, and account link must be visible without the fixed header covering content.
- Tablet and mobile stacking must remain intact.
- Merge PR #117 only after focused tests, full tests, typecheck, lint, build, preview route checks, and review-thread checks pass.

---

### Task 1: Add the viewport regression contract

**Files:**
- Modify: `src/app/auth-ui/auth-ui.test.ts`
- Test: `src/app/auth-ui/auth-ui.test.ts`

**Interfaces:**
- Consumes: `src/app/auth-ui/auth.css` as a source-level layout contract.
- Produces: assertions requiring login-specific desktop compaction, top alignment, and safe fixed-header spacing.

- [ ] **Step 1: Write the failing test**

Add a test that requires:

```ts
it("keeps the desktop login story and form inside the safe viewport", () => {
  const css = read("src/app/auth-ui/auth.css");

  expect(css).toContain('[data-auth-theme="black-signal"] .auth-layout');
  expect(css).toContain("align-items: start");
  expect(css).toContain('[data-auth-theme="black-signal"] .auth-display');
  expect(css).toContain('[data-auth-theme="black-signal"] .auth-operation-list');
  expect(css).toContain('@media (min-width: 861px) and (max-height: 1080px)');
});
```

- [ ] **Step 2: Run the focused test to verify RED**

Run through the existing Public Signup CI focused command.
Expected: FAIL because the login-specific desktop viewport rules do not yet exist.

- [ ] **Step 3: Commit the failing contract**

Commit message:

```text
test: cover login desktop viewport layout
```

### Task 2: Correct the login desktop layout

**Files:**
- Modify: `src/app/auth-ui/auth.css`
- Test: `src/app/auth-ui/auth-ui.test.ts`

**Interfaces:**
- Consumes: existing `.auth-stage`, `.auth-layout`, `.auth-display`, `.auth-operation-list`, `.auth-form-frame`, and Black Signal theme tokens.
- Produces: a login-specific desktop layout that starts below the fixed header and fits its primary interaction content within a 1000px-high viewport.

- [ ] **Step 1: Implement the minimal CSS fix**

Add Black Signal route-scoped rules that:

```css
[data-auth-theme="black-signal"] .auth-stage {
  padding-top: calc(var(--auth-header-height) + clamp(1rem, 1.8vw, 1.75rem));
}

[data-auth-theme="black-signal"] .auth-study-label {
  margin-bottom: clamp(1.25rem, 2vw, 2rem);
}

[data-auth-theme="black-signal"] .auth-layout {
  align-items: start;
  min-height: auto;
  gap: clamp(2rem, 4vw, 5rem);
}

[data-auth-theme="black-signal"] .auth-display {
  max-width: 9ch;
  font-size: clamp(4.25rem, 7vw, 8rem);
  line-height: 0.9;
}

[data-auth-theme="black-signal"] .auth-lead {
  margin-top: clamp(1.25rem, 2vw, 2rem);
}

[data-auth-theme="black-signal"] .auth-operation-list {
  margin-top: clamp(1.5rem, 2.5vw, 2.5rem);
}
```

Add a desktop short-height media query:

```css
@media (min-width: 861px) and (max-height: 1080px) {
  [data-auth-theme="black-signal"] .auth-stage {
    padding-bottom: 2rem;
  }

  [data-auth-theme="black-signal"] .auth-form-frame {
    padding: clamp(1.35rem, 2vw, 2rem);
  }

  [data-auth-theme="black-signal"] .auth-form-copy {
    margin-bottom: 1.5rem;
  }

  [data-auth-theme="black-signal"] .auth-field {
    margin-bottom: 1rem;
  }

  [data-auth-theme="black-signal"] .auth-security-meta {
    margin-top: 1.25rem;
  }
}
```

Keep existing `max-width: 860px` and `max-width: 560px` behavior authoritative for mobile.

- [ ] **Step 2: Run the focused test to verify GREEN**

Expected: the new viewport contract passes with all existing auth tests.

- [ ] **Step 3: Commit the CSS correction**

Commit message:

```text
fix: fit login experience within desktop viewport
```

### Task 3: Verify and merge

**Files:**
- No production changes unless a verification failure identifies a proven regression.
- Update: PR #117 description or conversation with final evidence.

**Interfaces:**
- Consumes: final feature-branch head.
- Produces: a READY Vercel preview and merged PR #117.

- [ ] **Step 1: Run the complete Public Signup CI gate**

Require:

```text
focused tests: success
full regression suite: success
typecheck: success
scoped lint: success
production build: success
```

- [ ] **Step 2: Check PR review state**

Require no unresolved review threads and a mergeable PR head.

- [ ] **Step 3: Deploy the exact head to Vercel preview**

Verify HTTP 200 for:

```text
/
/login?next=%2Fdashboard
/signup
```

Inspect the login page at the reported desktop viewport and confirm the fixed header does not cover the form heading and the primary form controls are visible.

- [ ] **Step 4: Merge PR #117**

Use the repository-supported merge method with `expected_head_sha` set to the verified head.

- [ ] **Step 5: Verify main**

Confirm PR #117 reports `merged: true`, fetch the resulting merge SHA, and confirm `main` contains the login viewport correction.
