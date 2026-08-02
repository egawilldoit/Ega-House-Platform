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
- Produces: A contract for copy, semantics, non-live positioning, one animated signal, and reduced-motion support.

- [x] **Step 1: Replace the old render expectations**

The test asserts the new badge, status, headline, result-first copy, all three flow nodes, all three safeguards, semantic safeguards list, and exactly one signal element. It rejects buttons, links, dismiss controls, and the superseded dark-card headline.

- [x] **Step 2: Define the CSS motion contract**

The CSS test reads the co-located stylesheet and verifies the signal keyframes, signal selector, and reduced-motion media query.

- [x] **Step 3: Verify RED against the old implementation**

The old component failed the new headline, flow, safeguards, and motion contract before production markup changed.

---

### Task 2: Build the premium light component

**Files:**
- Modify: `src/app/dashboard/_components/McpComingSoonAnnouncement.tsx`

**Interfaces:**
- Consumes: `Badge`, `StatusBadge`, Lucide icons, and CSS classes from Task 3.
- Produces: Stateless semantic markup for the announcement, connection flow, and safeguard indicators.

- [x] **Step 1: Replace dark-card markup**

The component now uses:

```tsx
<Badge tone="active">NEW IN EGA HOUSE</Badge>
<StatusBadge status="todo" label="Coming soon" />
```

It renders the approved result-first headline and copy, an accessible labelled flow, and a semantic list of safeguards.

- [x] **Step 2: Keep the component server-compatible**

No `use client`, React state, effects, browser storage, event handlers, or runtime fetches were added.

- [x] **Step 3: Keep the integration point unchanged**

The component remains the first content block inside `#dashboard-main`, immediately above the existing hero.

---

### Task 3: Add scoped surface, flow, and motion styles

**Files:**
- Modify: `src/app/dashboard/_components/dashboard.css`

**Interfaces:**
- Consumes: Existing variables `--foreground`, `--muted-foreground`, `--signal-live`, `--radius-card`, `--shadow-card`, and the dashboard `768px` breakpoint.
- Produces: `.mcp-launch-console`, flow-node, connector, signal, mobile, and reduced-motion rules.

- [x] **Step 1: Add the premium card surface**

The card uses a pale-mint/warm-off-white layered background, transparent gradient border, existing card radius/shadow, and a four-percent dot-grid texture.

- [x] **Step 2: Add the responsive connection flow**

Desktop uses a five-column node/connector layout. Mobile switches to a vertical stack and downward arrows at `768px`.

- [x] **Step 3: Add one traveling signal**

Only the first connector contains `.mcp-connector-signal`; it travels toward the secure gateway on a slow loop.

- [x] **Step 4: Respect reduced motion**

The reduced-motion query disables animation and leaves one static signal at the connector midpoint.

---

### Task 4: Verify and review the final branch

**Files:**
- Verify: component, test, CSS, existing dashboard placement, design, and plan.

- [x] **Step 1: Run isolated verification**

Fresh isolated checks on the final source confirmed:

- TypeScript component compilation passes with project-interface stubs.
- Required copy and semantic structure are present.
- No button, link, dismiss control, or superseded headline is present.
- Exactly one animated signal element is rendered.
- Signal keyframes and reduced-motion CSS exist.

- [ ] **Step 2: Run repository verification**

Still required on the complete checkout before merge:

```bash
npm test -- src/app/dashboard/_components/McpComingSoonAnnouncement.test.tsx
npm test
npm run typecheck
npm run lint
npm run build
```

- [x] **Step 3: Inspect branch scope**

The branch remains based on `main`, is not behind, and changes only the announcement implementation, dashboard placement, dashboard-scoped CSS, test, and Superpowers documents.

- [ ] **Step 4: Confirm hosted preview for the final SHA**

The latest known Vercel preview still targets an earlier branch SHA. A successful preview for the exact final head is required before merge.
