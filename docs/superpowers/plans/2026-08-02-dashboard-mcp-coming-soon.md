# Dashboard MCP Premium Light Announcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dark MCP dashboard announcement with a premium pale-mint card featuring a responsive AI-to-workspace flow and one reduced-motion-safe signal animation.

**Architecture:** Keep the existing stateless server component and dashboard placement. Rebuild its markup around existing `Badge` and `StatusBadge` primitives, add dashboard-scoped CSS for the premium surface and connection diagram, and strengthen the static-render contract before changing production markup.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, dashboard-scoped CSS, Lucide React, Vitest/node:test compatibility, `react-dom/server`.

## Global Constraints

- The card remains persistent and non-dismissible.
- Use future-facing language only; MCP is not presented as active.
- No launch date, countdown, toggle, primary CTA, or active status indicator.
- Reuse existing foreground, accent, badge, radius, shadow, and breakpoint tokens.
- The only animation is one signal traveling from AI clients toward the secure gateway.
- Reduced-motion users receive the same static flow without movement.
- No dependency, backend, route, storage, or feature-flag changes.

---

### Task 1: Define the premium announcement contract

**Files:**
- Modify: `src/app/dashboard/_components/McpComingSoonAnnouncement.test.tsx`

**Interfaces:**
- Consumes: `McpComingSoonAnnouncement(): React.JSX.Element` and co-located `dashboard.css`.
- Produces: A contract for copy, semantics, non-live positioning, and reduced-motion support.

- [ ] **Step 1: Replace the old render expectations**

The test must assert:

```tsx
assert.match(markup, /NEW IN EGA HOUSE/);
assert.match(markup, /Coming soon/);
assert.match(markup, /Your workspace is about to become AI-connected\./);
assert.match(markup, /Nothing changes until you choose to connect one\./);
assert.match(markup, /AI clients/);
assert.match(markup, /Secure gateway/);
assert.match(markup, /Projects · Goals · Tasks/);
assert.match(markup, /OAuth protected/);
assert.match(markup, /Scoped to your account/);
assert.match(markup, /Read-only first release/);
assert.match(markup, /role="img"/);
assert.doesNotMatch(markup, /<button/);
assert.doesNotMatch(markup, /href=/);
assert.doesNotMatch(markup, /Connect your AI to EGA House/);
```

Add a CSS contract using `readFileSync(new URL("./dashboard.css", import.meta.url), "utf8")` and assert both:

```tsx
assert.match(styles, /@keyframes mcp-signal-travel/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/app/dashboard/_components/McpComingSoonAnnouncement.test.tsx
```

Expected: FAIL because the current dark component lacks the new headline, flow, and trust copy.

- [ ] **Step 3: Commit the failing contract**

```bash
git add src/app/dashboard/_components/McpComingSoonAnnouncement.test.tsx
git commit -m "test: define premium MCP announcement contract"
```

---

### Task 2: Build the premium light component

**Files:**
- Modify: `src/app/dashboard/_components/McpComingSoonAnnouncement.tsx`

**Interfaces:**
- Consumes: `Badge`, `StatusBadge`, Lucide icons, and CSS classes from Task 3.
- Produces: Stateless semantic markup for the announcement, connection flow, and trust indicators.

- [ ] **Step 1: Replace dark-card markup**

Use these primitives:

```tsx
<Badge tone="active">NEW IN EGA HOUSE</Badge>
<StatusBadge status="todo" label="Coming soon" />
```

Use this result-first content:

```tsx
<h2>Your workspace is about to become AI-connected.</h2>
<p>
  Approved AI tools will soon be able to read your projects, goals, and tasks directly.
  Nothing changes until you choose to connect one.
</p>
```

Render one accessible flow wrapper:

```tsx
<div
  className="mcp-connection-flow"
  role="img"
  aria-label="Approved AI tools connect through a secure gateway to read projects, goals, and tasks."
>
  {/* AI clients → Secure gateway → Projects · Goals · Tasks */}
</div>
```

Render trust indicators with muted `Badge` components and lock, user, and eye icons.

- [ ] **Step 2: Keep the component server-compatible**

Do not add `use client`, React state, effects, browser storage, or event handlers.

- [ ] **Step 3: Commit markup**

```bash
git add src/app/dashboard/_components/McpComingSoonAnnouncement.tsx
git commit -m "feat: redesign MCP announcement as light connection console"
```

---

### Task 3: Add scoped surface, flow, and motion styles

**Files:**
- Modify: `src/app/dashboard/_components/dashboard.css`

**Interfaces:**
- Consumes: Existing variables `--foreground`, `--muted-foreground`, `--signal-live`, `--radius-card`, `--shadow-card`, and the dashboard `768px` breakpoint.
- Produces: `.mcp-launch-console`, flow-node, connector, signal, mobile, and reduced-motion rules.

- [ ] **Step 1: Add the premium card surface**

Implement:

```css
.mcp-launch-console {
  border: 1px solid transparent;
  border-radius: calc(var(--radius-card) + 0.25rem);
  background:
    linear-gradient(135deg, rgba(247, 250, 246, 0.98), rgba(251, 250, 246, 0.96)) padding-box,
    linear-gradient(120deg, transparent, rgba(23, 123, 82, 0.3), transparent) border-box;
  box-shadow: var(--shadow-card);
}
```

Add a full-bleed low-opacity dot-grid pseudo-element and keep it pointer-inert.

- [ ] **Step 2: Add the responsive connection flow**

Desktop uses a five-column grid: node, connector, gateway, connector, node. Mobile switches to one column and rotates arrows downward at the existing `768px` breakpoint.

- [ ] **Step 3: Add one traveling signal**

Define:

```css
@keyframes mcp-signal-travel {
  from { transform: translateX(0); opacity: 0; }
  18%, 82% { opacity: 1; }
  to { transform: translateX(var(--mcp-signal-distance)); opacity: 0; }
}
```

Only the first connector receives the animated signal. Mobile overrides the transform axis to vertical.

- [ ] **Step 4: Respect reduced motion**

Add:

```css
@media (prefers-reduced-motion: reduce) {
  .mcp-connector-signal {
    animation: none;
    opacity: 0.75;
    transform: translateX(50%);
  }
}
```

Include the vertical mobile equivalent.

- [ ] **Step 5: Commit styles**

```bash
git add src/app/dashboard/_components/dashboard.css
git commit -m "style: add premium MCP connection flow"
```

---

### Task 4: Verify and review the final branch

**Files:**
- Verify: component, test, CSS, existing dashboard placement, design, and plan.

- [ ] **Step 1: Run focused and full verification**

```bash
npm test -- src/app/dashboard/_components/McpComingSoonAnnouncement.test.tsx
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit successfully with no new warnings caused by the announcement.

- [ ] **Step 2: Inspect final changes**

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git log --oneline main..HEAD
```

Expected: no whitespace errors; only the intended announcement implementation and Superpowers documents differ from `main`.

- [ ] **Step 3: Update PR #114**

Record the final SHA, visual redesign summary, exact verification results, and any unavailable hosted checks. Do not claim full-suite or production-build success without fresh evidence.
