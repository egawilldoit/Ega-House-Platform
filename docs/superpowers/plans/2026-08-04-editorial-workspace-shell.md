# Editorial Workspace Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy green-glass authenticated shell with one editorial Black Signal and cream workspace system across every `AppShell` route, while preserving all existing feature behavior.

**Architecture:** Keep `AppShell` as the server-owned data boundary. Extract route metadata and navigation rendering into focused modules, add one client-owned responsive shell controller for tablet/mobile navigation, and apply route-scoped editorial compatibility styles to existing shared primitives. Dashboard data composition remains unchanged and receives presentation-only CSS refinement.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind 4, route-scoped CSS, Lucide React, Motion for React, Vitest, Testing Library, GitHub Actions, Vercel.

## Global Constraints

- Apply the redesign to every authenticated route rendered through `AppShell`.
- Reuse existing homepage/auth black, cream, citrus, signal-red, font, spacing, and motion tokens.
- Do not add another color system, font family, spacing scale, or animation dependency.
- Preserve Supabase authentication, authorization, queries, mutations, realtime behavior, URL contracts, keyboard shortcuts, quick-task behavior, and shell metrics.
- Complete the existing `useCanonicalUrl()` pattern for project navigation links.
- Desktop, tablet, and mobile navigation must work at 1440px, 1024px, and 390px.
- Honor `prefers-reduced-motion`; content availability must not depend on animation.
- Run focused tests, the full repository suite, TypeScript, scoped ESLint, production build, and exact-head Vercel preview before completion.

---

## File Structure

### Create

- `src/components/layout/shell-route-meta.ts` — single route metadata and numbered navigation model.
- `src/components/layout/sidebar-navigation.tsx` — reusable desktop, rail, and drawer navigation renderer.
- `src/components/layout/sidebar-mobile-drawer.tsx` — accessible client-owned mobile drawer and focus lifecycle.
- `src/components/layout/editorial-shell.css` — route-scoped shell, responsive navigation, compatibility, and shared primitive styles.
- `src/components/layout/editorial-shell.test.ts` — source contracts for global shell, tokens, breakpoints, canonical links, and dashboard preservation.
- `src/components/layout/sidebar-mobile-drawer.test.tsx` — interaction tests for open/close, Escape, backdrop, focus return, and ARIA.

### Modify

- `src/components/layout/app-shell.tsx` — import the editorial shell, apply theme boundary, and pass route-aware shell composition.
- `src/components/layout/sidebar.tsx` — preserve data/badges/quick task/logout while delegating navigation rendering and canonical project hrefs.
- `src/components/layout/top-bar.tsx` — add mobile menu trigger, route metadata, and editorial top-bar structure.
- `src/app/globals.css` — remove or neutralize conflicting legacy shell rules only where the route-scoped stylesheet cannot safely override them.
- `src/app/dashboard/_components/dashboard.css` — align dashboard panels to the editorial control-board hierarchy.
- `.github/workflows/public-signup-ci.yml` — include shared layout paths and focused shell tests in the existing complete UI gate.

---

### Task 1: Establish shell contracts and route metadata

**Files:**
- Create: `src/components/layout/editorial-shell.test.ts`
- Create: `src/components/layout/shell-route-meta.ts`
- Modify: `.github/workflows/public-signup-ci.yml`

**Interfaces:**
- Produces `type ShellRouteMeta = { href: string; index: string; label: string; group: "command" | "system"; eyebrow: string }`.
- Produces `COMMAND_ROUTES`, `SYSTEM_ROUTES`, and `getShellRouteMeta(pathname: string)`.

- [ ] **Step 1: Write the failing source contract**

Assert that the route model contains numbered Dashboard, Today, Tasks, Goals, Timer, Review, and Analytics entries; that `AppShell` imports `editorial-shell.css`; that project links resolve with `canonicalUrl.resolve`; and that CSS defines Black Signal, cream canvas, 1440/1024/390 contracts, and reduced-motion handling.

- [ ] **Step 2: Extend CI path filters and focused command**

Include `src/components/layout/**`, `src/app/dashboard/**`, and the new shell tests in Public Signup CI so GitHub produces the RED result.

- [ ] **Step 3: Run CI and verify RED**

Expected: only the new shell contract fails because route metadata and editorial shell files do not exist.

- [ ] **Step 4: Implement `shell-route-meta.ts`**

Define the command and system navigation metadata once, preserve existing route labels, and implement longest-prefix active-route matching for nested Tasks and project routes.

- [ ] **Step 5: Commit**

Commit message: `test: define editorial workspace shell contracts`.

---

### Task 2: Extract reusable navigation and canonical project links

**Files:**
- Create: `src/components/layout/sidebar-navigation.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Test: `src/components/layout/editorial-shell.test.ts`

**Interfaces:**
- `SidebarNavigation` consumes pathname, projects, metrics, task badge, canonical resolver, and optional `onNavigate`.
- It renders the same command, project, external Hermes, system, and logout hierarchy in desktop and drawer contexts.

- [ ] **Step 1: Add failing assertions**

Require one shared renderer, numbered command labels, preserved badges, and canonical resolution for `/tasks/projects/new`, `/tasks?project=...`, and `/tasks/projects`.

- [ ] **Step 2: Verify RED**

Expected: failures identify duplicated inline navigation and raw project hrefs.

- [ ] **Step 3: Implement the shared renderer**

Move navigation mapping out of `sidebar.tsx`; retain Lucide icons, active state, task/timer/review badges, project counts/statuses, Hermes, Help, Settings, and logout.

- [ ] **Step 4: Preserve sidebar-owned behavior**

Keep `QuickTaskSheet`, project color derivation, selected-project logic, and data types intact. Add native `title` text for truncated project names.

- [ ] **Step 5: Run focused tests and commit**

Commit message: `refactor: centralize workspace navigation`.

---

### Task 3: Build accessible tablet and mobile navigation

**Files:**
- Create: `src/components/layout/sidebar-mobile-drawer.tsx`
- Create: `src/components/layout/sidebar-mobile-drawer.test.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/layout/top-bar.tsx`

**Interfaces:**
- `SidebarMobileDrawer` props: `{ projects; goals; metrics; triggerId?: string }`.
- Drawer exposes a button with `aria-expanded` and `aria-controls`; dialog uses `aria-modal="true"` and labelled navigation.

- [ ] **Step 1: Write interaction tests**

Test opening, Escape dismissal, backdrop dismissal, close-on-navigation, focus moving into the drawer, focus returning to the trigger, and body-scroll restoration.

- [ ] **Step 2: Verify RED**

Expected: component missing.

- [ ] **Step 3: Implement drawer state and focus lifecycle**

Use React state/effects and existing Motion dependency. Lock body overflow only while open, restore the previous value on cleanup, and avoid motion when reduced motion is requested.

- [ ] **Step 4: Add tablet rail and mobile trigger composition**

Desktop keeps full sidebar; tablet uses compact rail presentation with accessible labels; mobile removes sidebar from layout flow and places the menu trigger in the top bar.

- [ ] **Step 5: Run focused interaction tests and commit**

Commit message: `feat: add responsive editorial workspace navigation`.

---

### Task 4: Apply the global editorial shell and primitive compatibility layer

**Files:**
- Create: `src/components/layout/editorial-shell.css`
- Modify: `src/components/layout/app-shell.tsx`
- Modify: `src/components/layout/top-bar.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/layout/editorial-shell.test.ts`

**Interfaces:**
- `AppShell` continues accepting the existing props without changes.
- The root receives `data-workspace-theme="editorial"` and imports `editorial-shell.css` after legacy globals.

- [ ] **Step 1: Add failing style assertions**

Require Black Signal sidebar, cream grid canvas, citrus active block, squared controls, sticky top bar, tablet rail, mobile drawer, 390px overflow protection, focus-visible rules, and reduced-motion rules.

- [ ] **Step 2: Verify RED**

Expected: style selectors and theme boundary missing.

- [ ] **Step 3: Implement shell tokens and layout**

Reuse existing auth/home values: black `#11110f`, paper/cream tokens, citrus `#ffd400`, signal `#ff4b2b`, existing display/body/mono fonts, and current spacing clamps.

- [ ] **Step 4: Implement compatibility styles**

Restyle `.instrument-card`, `.ega-shell-section`, `.btn-instrument`, `.input-instrument`, `.instrument-table`, `.status-badge`, `.surface-subtle`, `.surface-empty`, and shell search controls under the editorial theme boundary. Preserve semantic warning/error/info colors.

- [ ] **Step 5: Resolve legacy conflicts minimally**

Remove only declarations in `globals.css` that override responsive layout or cannot be safely superseded. Do not perform unrelated cleanup.

- [ ] **Step 6: Run focused tests and commit**

Commit message: `feat: apply editorial workspace shell globally`.

---

### Task 5: Polish dashboard control-board hierarchy

**Files:**
- Modify: `src/app/dashboard/_components/dashboard.css`
- Test: `src/components/layout/editorial-shell.test.ts`

**Interfaces:**
- Dashboard page and async panel component APIs remain unchanged.

- [ ] **Step 1: Add preservation and presentation assertions**

Require `Suspense`, `PanelErrorBoundary`, realtime refresh, timer prompt, and all existing async panels to remain in `dashboard/page.tsx`. Require dashboard CSS to use editorial rule, panel, metric, and responsive selectors.

- [ ] **Step 2: Verify RED for presentation-only selectors**

Existing behavioral assertions must already pass; new control-board presentation assertions fail.

- [ ] **Step 3: Refine dashboard CSS**

Flatten nested glass cards, strengthen panel rules, introduce numbered/monospace labels through existing classes and pseudo-elements where semantic markup is unnecessary, improve metric scale, and align grids at desktop/tablet/mobile widths.

- [ ] **Step 4: Preserve MCP announcement readability**

Restyle its surface inside the editorial canvas without removing content, flow diagram, or reduced-motion behavior.

- [ ] **Step 5: Run dashboard and shell tests and commit**

Commit message: `style: align dashboard with editorial control board`.

---

### Task 6: Complete repository verification, preview, and PR

**Files:**
- Create: `docs/implementation/2026-08-04-editorial-workspace-shell-evidence.md`
- Modify: `.github/workflows/public-signup-ci.yml` only if verification reveals missing paths or commands.

- [ ] **Step 1: Run focused tests**

Run the shell, drawer, dashboard, navigation, canonical URL, and existing public/auth regression tests. Expected: zero failures.

- [ ] **Step 2: Run the complete repository suite**

Run `npm test -- --run`. Expected: zero failures. Separate unrelated dependency-audit failures from code/test failures rather than changing dependencies inside this UI task.

- [ ] **Step 3: Run static gates**

Run `npm run typecheck`, scoped ESLint for layout/dashboard and changed files, and `npm run build`. Expected: exit code 0 for each.

- [ ] **Step 4: Review the exact diff**

Confirm no authentication, data-query, server-action, realtime, or route-contract changes. Confirm no second palette/font/motion dependency.

- [ ] **Step 5: Deploy exact branch head to Vercel preview**

Verify `/dashboard`, `/tasks`, `/goals`, `/timer`, `/review`, `/settings/account`, and one project route return successfully. Review 1440px, 1024px, and 390px layouts, keyboard navigation, and reduced-motion mode.

- [ ] **Step 6: Record evidence**

Document exact commit SHA, workflow run IDs, counts, build results, preview URL, reviewed routes, and any unrelated blockers.

- [ ] **Step 7: Open PR against `main`**

Title: `feat: bring authenticated workspace into editorial system`.

The PR must remain unmerged until the user reviews the exact-head preview.
