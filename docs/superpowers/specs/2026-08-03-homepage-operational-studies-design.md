# EGA House Homepage — Operational Studies Design

**Date:** 2026-08-03  
**Branch:** `feat/homepage-operational-studies`  
**Status:** Approved for implementation planning

## 1. Goal

Refactor the public EGA House homepage into a long-form editorial experience inspired by the visual system of the “200 Design Studies” archive while preserving EGA House’s own identity, product meaning, authentication behavior, and conversion paths.

The redesign must make the homepage feel like a sequence of connected operational modes rather than a conventional SaaS landing page composed of interchangeable cards.

The final page should communicate the EGA House workflow as six distinct studies:

1. Introduction
2. Goals
3. Planning
4. Focus
5. Review
6. Workspace conversion

Each study uses a different controlled environment while remaining part of one coherent design system.

## 2. Authoritative visual direction

The approved direction is **changing study environments**:

| Study | Palette | Product meaning |
|---|---|---|
| Hero | Cream, black, signal red | Introduction and system identity |
| Goals | Sea glass, forest | Quiet strategic structure |
| Planning | Terracotta, cream | Operational momentum and workload |
| Focus | Black, citrus yellow, signal red | Attention, timer state, active execution |
| Review | Cream, teal | Reflection, evidence, and correction |
| Conversion | Black, cream, signal red | Final decision and workspace entry |

The page must not copy the source website’s branding, wording, illustrations, or exact layouts. It should reuse the higher-level grammar:

- persistent editorial navigation;
- numbered studies;
- large typographic statements;
- visible grid and rule systems;
- controlled palette transitions;
- split-screen compositions;
- meaningful motion tied to scrolling;
- interface fragments used as product evidence.

## 3. Existing behavior that must remain intact

The homepage currently redirects authenticated users to `/dashboard`. This server-side behavior remains authoritative.

Unauthenticated conversion paths must remain intact:

- existing-user action: `/login?next=%2Fdashboard`;
- public signup action: `https://www.egawilldoit.online/signup`.

The redesign must preserve both entry points in the hero and final conversion study. It must not introduce a modal authentication flow, replace canonical signup URLs, or change session behavior.

The homepage must remain compatible with the current Next.js App Router architecture, React 19, Tailwind CSS 4, and the existing global font and theme infrastructure.

## 4. Experience architecture

### 4.1 Persistent study header

A sticky black header remains visible throughout the page.

Desktop structure:

```text
EGA HOUSE                  ONE SYSTEM / SIX STUDIES                  ENTER WORKSPACE ↓
```

Mobile structure:

```text
EGA HOUSE                         01 / 06
```

The header owns:

- brand label;
- current study index;
- compact study title;
- scroll-progress indicator;
- final workspace action on sufficiently wide screens.

The header updates as the active study changes. It does not own page content or authentication state.

### 4.2 Study model

Every section uses a shared structural contract:

```ts
type HomeStudy = {
  id: string;
  index: string;
  discipline: string;
  artDirection: string;
  theme: "signal" | "sea-glass" | "terracotta" | "citrus" | "review" | "conversion";
  headline: string;
  description: string;
};
```

The shared study shell provides:

- semantic section element;
- stable anchor;
- metadata rule;
- background environment;
- content container;
- responsive spacing;
- reduced-motion state;
- intersection observation hooks.

Section-specific components own only their internal presentation.

## 5. Section designs

### 5.1 Study 00 — Introduction / Signal Cream

Purpose: establish EGA House as an operating system for translating intent into execution.

Composition:

- full-height split layout;
- oversized `EGA`, `01`, or other owned EGA graphic signal on the left;
- large multi-line headline on the right;
- short product explanation;
- primary login CTA;
- secondary account-creation CTA;
- small operational index showing Goals, Tasks, Focus, and Review.

Approved headline direction:

```text
One operating system
for turning intention
into execution.
```

The exact final copy may be tightened during implementation, but it must retain this meaning and avoid generic AI or productivity claims.

Motion:

- headline lines reveal in sequence;
- oversized signal rises and settles;
- fine orbital or rule geometry shifts slightly with scroll;
- CTA and index enter after the primary statement.

### 5.2 Study 01 — Goals / Sea Glass

Purpose: communicate strategic clarity and hierarchy.

Composition:

- sea-glass full-width environment;
- editorial serif/sans contrast;
- large statement on the left;
- structured goal interface on the right;
- strategic objective, milestone, and next action shown as a clear hierarchy;
- restrained shadow and border treatment.

Approved statement direction:

```text
Quiet structure.
Loud intent.
```

Product evidence should represent real EGA House concepts, not arbitrary placeholder analytics.

Motion:

- hierarchy rows enter with short stagger;
- active item receives a restrained emphasis state;
- background glow drifts only when reduced motion is not requested.

### 5.3 Study 02 — Planning / Terracotta

Purpose: demonstrate movement from goals into operational work.

Composition:

- terracotta field;
- large left-side planning statement;
- right-side task distribution or workload visualization;
- metrics such as active tasks, linked goals, current execution ratio, or planning horizon;
- graphic bars and rules that feel editorial rather than like a generic dashboard widget.

Approved statement direction:

```text
Warmth,
without
the noise.
```

The final statement may be adapted to planning language while keeping the same cadence.

Motion:

- bars animate from a stable baseline once;
- metric numerals reveal after the graph;
- vertical rules and labels draw into place;
- no continuous chart movement.

### 5.4 Study 03 — Focus / Citrus Black

Purpose: create the most dramatic point in the narrative and represent active execution.

Composition:

- black environment;
- citrus yellow, cream, and signal-red geometry;
- large session timer or focus duration;
- active task title;
- circular progress, orbital signal, or concentric focus field;
- strong but readable contrast.

Approved statement direction:

```text
Turn attention
into momentum.
```

Motion:

- circular geometry rotates or shifts in a bounded scroll-linked range;
- progress line grows with section entry;
- timer value remains stable unless it is explicitly presented as a demonstration;
- all decorative motion is disabled or reduced under reduced-motion preferences.

### 5.5 Study 04 — Review / Cream Teal

Purpose: show that execution is followed by evidence, reflection, and correction.

Composition:

- cream editorial grid;
- teal type and dark body copy;
- a weekly review list or matrix;
- completed work, unresolved work, lessons, and next corrections;
- strong horizontal rules and visible sequence numbering.

Approved statement direction:

```text
Review the evidence.
Correct the system.
```

Motion:

- review rows reveal in reading order;
- divider rules extend horizontally;
- key correction receives a brief emphasis state;
- no parallax is required in this section.

### 5.6 Study 05 — Conversion / Black Signal

Purpose: close the narrative with a clear decision.

Composition:

- black background;
- cream statement;
- signal-red accent;
- concise product summary;
- signup and login actions;
- no additional feature grid after the final CTA.

Approved copy direction:

```text
Build the week.
Run the day.
Review the system.
```

Actions:

- `Create account` → canonical public signup URL;
- `Enter workspace` → `/login?next=%2Fdashboard`.

## 6. Scrolling and motion strategy

### 6.1 Native scrolling remains authoritative

The implementation must not introduce a scroll-hijacking library.

Use:

- browser-native scrolling;
- semantic section anchors;
- `scroll-margin-top` for sticky-header offsets;
- optional soft section alignment;
- IntersectionObserver or Motion viewport tracking;
- a sticky header and thin progress line.

Avoid:

- forced wheel interception;
- mandatory full-screen snapping;
- momentum overrides;
- scroll behavior that breaks keyboard navigation or browser history;
- animation that delays access to content.

### 6.2 Motion library

Use Motion for React as the single animation foundation.

Motion responsibilities:

- initial hero sequencing;
- viewport-triggered reveals;
- bounded scroll-linked transforms;
- active-study state;
- reduced-motion integration;
- graph and rule animations.

Do not add GSAP, Lenis, Three.js, or a second animation system for this scope.

### 6.3 Animation rules

Prefer:

- transforms;
- opacity;
- clip-path where supported and justified;
- CSS custom properties;
- SVG stroke or dimension animation for simple diagrams.

Avoid animating layout-heavy properties such as large sets of width, height, top, or left values during continuous scrolling.

Continuous decorative effects must be minimal, bounded, and paused when not visible.

## 7. Accessibility

The homepage must remain usable without animation and without a pointer.

Requirements:

- honor `prefers-reduced-motion`;
- preserve visible focus states;
- use links for navigation actions;
- maintain semantic heading order;
- ensure decorative geometry is hidden from assistive technology;
- maintain sufficient contrast across every palette;
- avoid hover-only access to content;
- retain readable text at 200% zoom;
- prevent sticky elements from covering focused content;
- ensure all critical information is present in the DOM without waiting for animation completion.

Under reduced motion:

- parallax and orbital transformations are disabled;
- reveal distances become zero;
- duration is reduced substantially;
- content may fade or render immediately;
- native scrolling remains unchanged.

## 8. Responsive behavior

### Desktop

- full-height studies where content volume allows;
- split compositions;
- persistent three-part header;
- large display scale;
- bounded content width for readability.

### Tablet

- preserve two-column layouts where readable;
- reduce display type scale;
- allow interface fragments to move below statements;
- simplify decorative geometry.

### Mobile

- stack each study vertically;
- keep metadata compact;
- avoid strict `100vh` assumptions by using dynamic viewport units;
- reduce or remove parallax;
- make charts horizontally safe without overflow;
- preserve 44px minimum interactive targets;
- keep the current-study label in the sticky header;
- ensure CTA actions are fully visible without horizontal scrolling.

## 9. Proposed code boundaries

```text
src/app/
├── page.tsx
└── home/
    ├── home-page.tsx
    ├── home-data.ts
    ├── home.types.ts
    ├── home.css
    ├── components/
    │   ├── study-header.tsx
    │   ├── study-shell.tsx
    │   ├── study-label.tsx
    │   ├── scroll-progress.tsx
    │   ├── animated-rule.tsx
    │   └── home-cta.tsx
    └── sections/
        ├── hero-study.tsx
        ├── goals-study.tsx
        ├── planning-study.tsx
        ├── focus-study.tsx
        ├── review-study.tsx
        └── conversion-study.tsx
```

Responsibilities:

- `page.tsx`: current-user lookup, authenticated redirect, server composition;
- `home-page.tsx`: public homepage composition and Motion configuration boundary;
- `home-data.ts`: stable copy, metadata, and product demonstration values;
- `home.css`: route-scoped tokens, environments, layout rules, and reduced-motion fallbacks;
- shared components: repeated editorial structure;
- section components: unique study content and visuals.

No homepage-specific palette rules should be added to unrelated application-shell selectors.

## 10. Data and state flow

The homepage is largely static and must not add a server data dependency.

Flow:

1. `page.tsx` resolves the current user.
2. Authenticated users redirect to `/dashboard`.
3. Unauthenticated users receive the public study composition.
4. Static study metadata is passed into shared structural components.
5. A small client boundary observes active sections and scroll progress.
6. The header derives its visible study index from that client state.
7. Conversion links navigate normally.

No analytics, personalization, authenticated product data, or background request is introduced by this redesign.

## 11. Error and fallback behavior

Because the page is static after authentication resolution, runtime error surface should remain small.

Required fallbacks:

- all content remains visible if JavaScript fails;
- CSS environments render without Motion;
- unsupported backdrop filters fall back to opaque backgrounds;
- decorative SVG or CSS geometry may disappear without affecting meaning;
- missing optional imagery must not collapse the layout;
- reduced-motion mode is a first-class supported path, not an afterthought.

## 12. Performance constraints

- preserve server rendering for the page shell and content;
- keep client components narrowly scoped;
- use one animation dependency only;
- avoid large video, canvas, WebGL, or 3D assets;
- avoid loading remote visual assets for the core design;
- use CSS and lightweight SVG for geometry;
- prevent cumulative layout shift by reserving all visual space;
- do not animate large blurred layers continuously on low-power mobile devices;
- lazy-load any non-critical visual media added later;
- target smooth interaction without making a fixed frame-rate claim unsupported by testing.

## 13. Testing and validation

### Automated

Add focused coverage for:

- authenticated redirect remains present;
- canonical signup URL remains present in the hero and conversion study;
- login destination remains `/login?next=%2Fdashboard`;
- six study anchors and metadata are rendered;
- semantic heading order is valid at the source-contract level where practical;
- reduced-motion CSS and Motion configuration are present;
- homepage files are included in the relevant CI path filters.

Run:

- focused homepage tests;
- existing signup-discovery tests;
- TypeScript typecheck;
- scoped ESLint;
- production Next.js build;
- Playwright viewport checks if existing infrastructure can support them without broadening scope.

### Manual

Validate at minimum:

- desktop Chrome;
- desktop Firefox or Safari-equivalent engine coverage where available;
- narrow mobile viewport;
- keyboard-only navigation;
- reduced-motion enabled;
- 200% zoom;
- slow CPU/device emulation;
- JavaScript-disabled content visibility where practical;
- correct signup and login navigation.

## 14. Scope boundaries

Included:

- homepage component refactor;
- six-study visual redesign;
- sticky study header;
- progress and active-study behavior;
- Motion dependency;
- route-scoped animation and layout CSS;
- responsive and reduced-motion support;
- focused regression coverage.

Excluded:

- dashboard redesign;
- login or signup redesign;
- new authentication behavior;
- new backend services;
- live product metrics on the public page;
- 3D, WebGL, video backgrounds, or shader effects;
- global smooth-scroll interception;
- copying the 200 Design Studies source implementation;
- broad global theme refactoring unrelated to the homepage.

## 15. Acceptance criteria

The work is accepted when:

1. The homepage renders as six visually distinct but coherent operational studies.
2. The page clearly communicates Goals → Planning → Focus → Review → Workspace entry.
3. The sticky header shows progress and the active study without blocking navigation.
4. Motion enhances hierarchy and scrolling but does not control native scrolling.
5. Reduced-motion users receive a stable, complete, and readable experience.
6. Mobile layouts do not overflow and preserve all actions.
7. Authenticated redirect and canonical login/signup paths are unchanged.
8. The homepage no longer exists as one monolithic presentation component.
9. No unnecessary second animation or visual framework is introduced.
10. Focused tests, existing signup-discovery coverage, typecheck, lint, and production build pass.
