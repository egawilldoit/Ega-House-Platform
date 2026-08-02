# Dashboard MCP Coming Soon Announcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, accessible MCP coming-soon announcement above the `/dashboard` hero without implying the integration is already live.

**Architecture:** Introduce one stateless presentational React component co-located with dashboard components, verify its public copy and semantics through server-side static rendering, and mount it once in the dashboard page. No runtime data, client state, feature flag, dependency, or backend change is required.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Lucide React, Vitest with `node:test` compatibility, `react-dom/server`.

## Global Constraints

- The banner is persistent and has no dismiss control.
- Use future-facing `coming soon` language; do not state that MCP production access is live.
- Advertise owner-scoped, OAuth-protected read access only.
- Name projects, goals, and tasks as the initial readable workspace entities.
- Do not add a launch date, write capability, dependency, feature flag, or integration link.
- Place the announcement immediately above the existing dashboard hero.

---

### Task 1: Define the announcement contract with a failing static-render test

**Files:**
- Create: `src/app/dashboard/_components/McpComingSoonAnnouncement.test.tsx`

**Interfaces:**
- Consumes: `McpComingSoonAnnouncement(): React.JSX.Element` from `./McpComingSoonAnnouncement`.
- Produces: A rendering contract for copy, semantic labeling, capability positioning, and persistent behavior.

- [ ] **Step 1: Write the failing test**

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { McpComingSoonAnnouncement } from "./McpComingSoonAnnouncement";

test("renders the persistent MCP coming-soon announcement with safe launch positioning", () => {
  const markup = renderToStaticMarkup(<McpComingSoonAnnouncement />);

  assert.match(markup, /aria-labelledby="mcp-coming-soon-title"/);
  assert.match(markup, /MCP · COMING SOON/);
  assert.match(markup, /Connect your AI to EGA House\./);
  assert.match(markup, /projects, goals, and tasks/);
  assert.match(markup, /OAuth-protected/);
  assert.match(markup, /Owner-scoped access/);
  assert.match(markup, /Read-only at launch/);
  assert.doesNotMatch(markup, /Dismiss/i);
});
```

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
npm test -- src/app/dashboard/_components/McpComingSoonAnnouncement.test.tsx
```

Expected: FAIL because `./McpComingSoonAnnouncement` does not exist.

- [ ] **Step 3: Commit the failing contract**

```bash
git add src/app/dashboard/_components/McpComingSoonAnnouncement.test.tsx
git commit -m "test: define dashboard MCP announcement contract"
```

---

### Task 2: Implement the presentational announcement component

**Files:**
- Create: `src/app/dashboard/_components/McpComingSoonAnnouncement.tsx`
- Test: `src/app/dashboard/_components/McpComingSoonAnnouncement.test.tsx`

**Interfaces:**
- Consumes: Existing CSS custom properties for dashboard cards and Lucide icon components.
- Produces: `McpComingSoonAnnouncement(): React.JSX.Element`, a server-compatible stateless component.

- [ ] **Step 1: Add the minimal component implementation**

```tsx
import {
  Bot,
  Cable,
  Eye,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

const capabilityItems = [
  { label: "Owner-scoped access", icon: ShieldCheck },
  { label: "Read-only at launch", icon: Eye },
  { label: "Built for MCP clients", icon: Cable },
] as const;

export function McpComingSoonAnnouncement() {
  return (
    <aside
      aria-labelledby="mcp-coming-soon-title"
      className="relative isolate overflow-hidden rounded-[calc(var(--radius-card)+0.25rem)] border border-white/15 bg-[linear-gradient(135deg,#0f241c_0%,#173b2d_48%,#177b52_120%)] p-5 text-white shadow-[var(--shadow-card)] sm:p-6"
    >
      <div
        aria-hidden="true"
        className="absolute -right-16 -top-20 -z-10 h-56 w-56 rounded-full bg-white/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute bottom-0 right-0 -z-10 h-24 w-40 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.18)_1px,transparent_1px)] bg-[length:12px_12px] opacity-50"
      />

      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[0.68rem] font-semibold tracking-[0.16em] text-emerald-50">
            <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
            MCP · COMING SOON
          </div>

          <h2
            id="mcp-coming-soon-title"
            className="mt-4 font-display text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl"
          >
            Connect your AI to EGA House.
          </h2>

          <p className="mt-3 max-w-3xl text-sm leading-7 text-white/75 sm:text-[0.95rem]">
            Soon, approved AI clients will be able to securely read your projects,
            goals, and tasks through an OAuth-protected EGA House connection.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {capabilityItems.map(({ label, icon: Icon }) => (
              <span
                key={label}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/10 px-3 py-2 text-xs font-medium text-white/90"
              >
                <Icon aria-hidden="true" className="h-3.5 w-3.5 text-emerald-200" />
                {label}
              </span>
            ))}
          </div>

          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-white/60">
            <LockKeyhole aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Your workspace stays private. Access is granted per user and per approved client.
          </p>
        </div>

        <div
          aria-hidden="true"
          className="hidden h-28 w-28 place-items-center rounded-[1.75rem] border border-white/15 bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] lg:grid"
        >
          <div className="relative grid h-16 w-16 place-items-center rounded-2xl border border-emerald-200/25 bg-emerald-200/10">
            <Bot className="h-8 w-8 text-emerald-100" />
            <span className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full border border-white/20 bg-[#177b52]">
              <Cable className="h-3.5 w-3.5 text-white" />
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Run the focused test to verify GREEN**

Run:

```bash
npm test -- src/app/dashboard/_components/McpComingSoonAnnouncement.test.tsx
```

Expected: PASS with one passing test and no warnings.

- [ ] **Step 3: Commit the component**

```bash
git add src/app/dashboard/_components/McpComingSoonAnnouncement.tsx
git commit -m "feat: add dashboard MCP coming-soon announcement"
```

---

### Task 3: Mount the announcement above the dashboard hero

**Files:**
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `McpComingSoonAnnouncement` from `./_components/McpComingSoonAnnouncement`.
- Produces: A persistent banner as the first visible element in `#dashboard-main`.

- [ ] **Step 1: Import the component**

Add:

```tsx
import { McpComingSoonAnnouncement } from "./_components/McpComingSoonAnnouncement";
```

- [ ] **Step 2: Render it before the Hero panel**

Inside `<main id="dashboard-main" ...>`, add:

```tsx
<McpComingSoonAnnouncement />
```

immediately before:

```tsx
<PanelErrorBoundary panelName="Hero">
```

- [ ] **Step 3: Run complete verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit successfully with no new errors or warnings caused by this change.

- [ ] **Step 4: Commit the dashboard integration**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat: surface MCP announcement on dashboard"
```

---

### Task 4: Review the branch evidence

**Files:**
- Review only: all branch changes against `main`.

**Interfaces:**
- Consumes: Branch commits and CI results.
- Produces: A completion report with exact changed files, commit SHA, and verification status.

- [ ] **Step 1: Inspect the branch diff**

Run:

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git log --oneline main..HEAD
```

Expected: only the design, plan, announcement test, announcement component, and dashboard page are changed; `git diff --check` emits no output.

- [ ] **Step 2: Confirm CI for the exact branch head**

Verify that test, typecheck, lint, and build checks correspond to the final commit SHA. Do not report success from an older commit.
