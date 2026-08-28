# Editorial Workspace Shell — Design Specification

**Date:** 2026-08-04
**Status:** Approved for implementation planning
**Branch:** `feat/editorial-workspace-shell`
**Base:** `main`

## 1. Objective

Bring every authenticated EGA House page into the editorial visual system established by the public landing page and authentication surfaces.

The redesign applies globally to routes rendered through `AppShell`, including Dashboard, Tasks, Ideas, Today, Goals, Timer, Review, Analytics, Startup, Shutdown, Help, Settings, Apps, and project views.

This is a presentation and navigation-shell refactor. Existing feature behavior, data loading, permissions, mutations, realtime behavior, and URL contracts remain authoritative and unchanged unless a navigation link must be corrected to preserve the existing canonical-host contract.

## 2. Design Direction

The authenticated product becomes an editorial operational workspace rather than a green glass dashboard.

The visual language reuses the existing homepage/auth system:

- black signal navigation surfaces;
- cream operational canvas;
- citrus yellow and signal red accents;
- visible grid lines and rules;
- monospace metadata labels;
- large but controlled display typography;
- squared or lightly rounded controls;
- clear numbered navigation and panel hierarchy;
- restrained motion with reduced-motion support.

No unrelated color palette, font family, spacing scale, or animation framework will be introduced.

## 3. Architecture

### 3.1 Shared shell boundary

`src/components/layout/app-shell.tsx` remains the single authenticated shell boundary.

It continues to own:

- sidebar project and goal loading;
- shell metrics loading;
- keyboard shortcuts;
- top bar;
- page header;
- page content frame.

The implementation may split presentation into focused components, but it must not duplicate shell data loading across pages.

### 3.2 Proposed component structure

```text
src/components/layout/
├── app-shell.tsx
├── editorial-shell.css
├── sidebar.tsx
├── sidebar-mobile-drawer.tsx
├── sidebar-navigation.tsx
├── top-bar.tsx
├── shell-route-meta.ts
└── existing behavior components
```

Existing components may be retained where their behavior is already correct. New components should isolate responsive drawer behavior, route metadata, and navigation rendering rather than growing `sidebar.tsx` further.

### 3.3 Compatibility layer

Existing pages use shared classes such as `instrument-card`, `ega-shell-section`, `btn-instrument`, `input-instrument`, `status-badge`, and table/surface utilities.

Those primitives will receive an editorial compatibility treatment so existing feature pages inherit the new system without page-by-page markup rewrites.

Page-specific CSS remains valid and is adjusted only where it conflicts with the new shell or causes unreadable contrast.

## 4. Global Shell

### 4.1 Desktop layout

- Persistent Black Signal sidebar.
- Cream grid-based content canvas.
- Sticky editorial top bar.
- Content width remains bounded and responsive.
- Sidebar and top bar use existing safe-area and viewport constraints.
- No horizontal overflow at supported widths.

### 4.2 Sidebar hierarchy

The navigation is organized into explicit operational groups:

```text
EGA HOUSE
OPERATING SYSTEM

+ QUICK TASK

COMMAND
01 Dashboard
02 Today
03 Tasks
04 Goals
05 Timer
06 Review
07 Analytics

PROJECTS
• Project rows
+ View all projects

SYSTEM
Startup
Shutdown
Apps
Hermes
Help
Settings
Sign out
```

Requirements:

- active navigation uses a citrus block with black text;
- focus states remain visible and keyboard accessible;
- task, timer, review, project-count, and status badges remain functional;
- project data, pinned ordering, quick-task behavior, and logout behavior remain unchanged;
- navigation labels do not truncate at supported desktop widths;
- long project names may truncate with accessible full text through native title or equivalent semantics;
- the sidebar remains independently scrollable when content exceeds viewport height.

### 4.3 Canonical navigation

All shell links that can cross workspace subdomains must resolve through the existing canonical URL mechanism.

This includes remaining project routes:

- `/tasks/projects/new`;
- `/tasks?project=...`;
- `/tasks/projects`.

No new navigation protocol is introduced. The implementation completes the existing `useCanonicalUrl()` pattern.

## 5. Top Bar

The top bar becomes a compact operational strip.

It preserves:

- global search;
- shell signal cluster;
- Apps access;
- keyboard-shortcuts access;
- messages;
- notifications;
- user profile marker.

Presentation:

- current route metadata or breadcrumb at the left edge;
- search in the flexible center region;
- actions and signals aligned at the right edge;
- squared editorial controls instead of rounded glass pills;
- no clipped controls at 1440px, 1024px, or 390px;
- search remains usable with keyboard and screen readers.

## 6. Responsive Navigation

### 6.1 Desktop

At wide desktop widths, the full sidebar remains visible.

### 6.2 Tablet

At the tablet breakpoint, the shell uses a compact icon rail or equivalent reduced-width navigation that preserves accessible labels and active-route state.

The implementation must avoid a layout where page content becomes too narrow to remain usable.

### 6.3 Mobile

At mobile widths:

- the persistent sidebar is removed from layout flow;
- the top bar exposes a navigation-menu button;
- the button opens a Black Signal drawer;
- the drawer contains the same navigation hierarchy and project links;
- Escape closes the drawer;
- clicking the backdrop closes the drawer;
- navigation closes the drawer;
- focus moves into the drawer when opened and returns to the trigger when closed;
- `aria-expanded`, `aria-controls`, and dialog/navigation semantics are correct;
- body scrolling is locked while the drawer is open;
- no horizontal overflow occurs at 390px.

## 7. Page Header And Content Canvas

Every authenticated page receives:

- cream editorial grid canvas;
- consistent top spacing below the sticky top bar;
- monospace eyebrow metadata;
- stronger display title;
- controlled description width;
- action area that wraps safely;
- visible section rules and grid alignment.

The page header remains driven by existing `AppShell` props. Pages are not required to adopt new data contracts.

## 8. Shared UI Primitives

The existing shared classes are restyled rather than replaced wholesale.

### 8.1 Cards and sections

- flatter surfaces;
- sharper borders;
- reduced glass blur;
- restrained shadows;
- clearer section labels;
- consistent cream, paper, black, citrus, signal-red, and existing semantic status colors.

### 8.2 Buttons and inputs

- squared or lightly rounded controls;
- stronger border contrast;
- explicit hover, active, disabled, and focus states;
- semantic status colors remain unchanged where they communicate health, warning, or error.

### 8.3 Tables, badges, and empty states

- preserve all content and behavior;
- align typography and borders with the editorial system;
- maintain readable density for operational data;
- avoid decorative styling that reduces scanability.

## 9. Dashboard-Specific Treatment

`/dashboard` receives the deepest page-level polish while keeping its current data composition and boundaries.

Preserved behavior:

- `Suspense` boundaries;
- panel error boundaries;
- realtime owner-scoped refresh;
- timer stop outcome prompt;
- debug data route;
- all async data services and queries;
- current dashboard panel components.

Presentation changes:

- operational hero aligned to the editorial shell;
- command-center metrics rendered as a coherent control board;
- clearer visual grouping for Today, Focus, Goals, Projects, Timer, and Review;
- fewer nested rounded cards;
- numbered labels and stronger metric hierarchy;
- consistent panel rules and spacing;
- MCP announcement remains present and readable.

## 10. Motion And Accessibility

Motion is limited to interface-level transitions such as drawer entry, active-state movement, and panel reveal where already supported.

Requirements:

- use the existing Motion dependency only;
- honor `prefers-reduced-motion`;
- never make content availability depend on animation;
- preserve visible focus states;
- preserve semantic landmarks and headings;
- maintain sufficient contrast in black, cream, citrus, and status surfaces;
- no hover-only information;
- no scroll hijacking.

## 11. Behavioral Safety Boundaries

The redesign must not change:

- Supabase authentication or authorization;
- database queries and ownership scopes;
- task, goal, timer, review, project, startup, or shutdown behavior;
- server actions;
- realtime subscription semantics;
- mutation revalidation behavior;
- URL and redirect contracts;
- canonical subdomain routing behavior;
- keyboard-shortcut commands;
- quick-task business logic;
- shell metric calculations.

## 12. Testing Strategy

### 12.1 Structural contracts

Add focused tests that verify:

- authenticated routes still render through `AppShell`;
- the editorial shell stylesheet and theme boundary are present;
- navigation groups and route numbering are defined once;
- project links use canonical URL resolution;
- dashboard panels remain composed through existing async and error boundaries.

### 12.2 Interaction tests

Add or extend tests for:

- active route state;
- mobile drawer open and close;
- Escape dismissal;
- backdrop dismissal;
- focus entry and return;
- `aria-expanded` and `aria-controls`;
- navigation closing the drawer;
- logout and quick-task access remaining reachable.

### 12.3 Responsive contracts

Source and rendered checks cover:

- 1440px desktop;
- 1024px tablet;
- 390px mobile;
- no horizontal overflow;
- no clipped sidebar/top-bar actions;
- readable page headers and cards;
- keyboard-only navigation;
- reduced-motion mode.

### 12.4 Repository gates

Before completion:

- focused shell/dashboard tests;
- complete repository test suite;
- TypeScript;
- scoped ESLint;
- production Next.js build;
- Vercel preview of the exact branch head;
- browser review of Dashboard, Tasks, Goals, Timer, Review, Settings, and one project route at desktop, tablet, and mobile widths.

## 13. Delivery Sequence

1. Add shell regression tests and verify RED.
2. Introduce route metadata and shared navigation model.
3. Implement Black Signal desktop sidebar.
4. Implement tablet rail and mobile drawer.
5. Refine top bar and page header.
6. Add editorial compatibility styles for shared primitives.
7. Polish dashboard-specific panels.
8. Correct canonical project navigation links.
9. Run focused and complete verification.
10. Deploy exact-head Vercel preview and review representative authenticated routes.
11. Open a pull request against `main`.

## 14. Acceptance Criteria

1. Every authenticated page using `AppShell` displays the new editorial workspace shell.
2. Desktop, tablet, and mobile navigation remain fully usable at 1440px, 1024px, and 390px.
3. The mobile drawer is keyboard and screen-reader accessible.
4. Active route, task/timer/review badges, project counts, quick task, logout, and shell signals remain functional.
5. Existing authenticated-page business logic and data contracts are unchanged.
6. Remaining sidebar project links resolve through the canonical URL mechanism.
7. Existing shared cards, buttons, inputs, tables, badges, and empty states visually align with the new shell.
8. Dashboard hierarchy is materially improved without removing or replacing its current data panels.
9. No new palette, font family, spacing system, or animation framework is introduced.
10. Focused tests, full tests, TypeScript, lint, build, and exact-head preview verification pass before merge.
