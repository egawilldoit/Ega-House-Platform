# Homepage and Auth Editorial Refinement Design

**Status:** Approved direction, ready for implementation planning  
**Branch:** `feat/homepage-operational-studies`  
**PR:** #117  
**Date:** 2026-08-03

## 1. Objective

Refine the existing operational-studies homepage so it feels more deliberate, balanced, and presentation-ready at normal browser zoom levels, then redesign `/login` and `/signup` to feel like native extensions of the same editorial system.

The implementation must preserve all existing authentication behavior, redirects, validation, accessibility, and signup security controls.

## 2. Approved visual direction

Use a complementary pair:

- **Login:** Black Signal — dark grid, cream typography, citrus-yellow focus geometry, red signal accents.
- **Signup:** Signal Cream — cream grid, black typography, red signal accents, restrained blue orbital lines.

Both pages share:

- the same fixed editorial header language as the homepage;
- numbered study metadata;
- oversized display typography;
- square or lightly rounded controls rather than soft glass cards;
- visible grid systems and structural rules;
- geometric motion tied to attention and state;
- one consistent token set for spacing, type, color, borders, and motion;
- reduced-motion fallbacks.

## 3. Homepage refinement

The current homepage concept is retained. The refinement focuses on polish rather than redesigning the architecture again.

### 3.1 Composition

- Rebalance large-scale typography so headings do not visually collide with the fixed header at standard zoom.
- Improve section vertical rhythm and whitespace between labels, headings, body copy, boards, and CTAs.
- Constrain maximum line lengths and board widths for better readability on wide screens.
- Improve optical alignment of section labels, numbers, rules, charts, and CTA groups.
- Ensure every study has a strong first viewport composition at 100% browser zoom.

### 3.2 Scrolling and transitions

- Keep browser-native scrolling authoritative.
- Retain the current scroll-progress line and active study indicator.
- Add subtle section-to-section atmosphere transitions through bounded color, opacity, and transform changes.
- Improve reveal sequencing so labels, headings, supporting copy, and interface specimens enter in a controlled order.
- Prevent motion from obscuring content or creating delayed interaction.

### 3.3 Responsive behavior

- Desktop: preserve the editorial split layouts while reducing oversized empty zones.
- Tablet: collapse complex boards earlier and maintain clear reading order.
- Mobile: replace decorative scale with compact composition; all controls remain fully visible without horizontal scrolling.
- Test at 100%, 90%, and 80% browser zoom in addition to narrow viewport sizes.

## 4. Shared auth architecture

Create a shared public-auth presentation layer instead of maintaining separate unrelated design systems.

Proposed structure:

```text
src/app/auth-ui/
├── auth-shell.tsx
├── auth-header.tsx
├── auth-study-label.tsx
├── auth-geometry.tsx
├── auth-motion.tsx
├── auth-field.tsx
├── auth-submit.tsx
├── auth-feedback.tsx
├── auth.tokens.css
└── auth.css
```

The shared layer owns layout, typography, geometry, motion, field presentation, feedback styling, and reduced-motion behavior.

The existing login and signup forms continue to own authentication logic, field state, validation, Supabase calls, Turnstile, safe redirects, and success states.

## 5. Login design — Black Signal

### 5.1 Layout

- Fixed black editorial header with `EGA HOUSE`, `AUTH / SIGN IN`, and a create-account action.
- Two-column desktop composition:
  - left: oversized editorial message and a citrus/red focus geometry;
  - right: compact sign-in form aligned to structural grid lines.
- On mobile, the message compresses above the form and geometry becomes a small background signal.

### 5.2 Content hierarchy

- Study label: `AUTH 01 / SIGN IN / BLACK SIGNAL`.
- Headline: a concise operational message such as “Return to the system.”
- Supporting copy explains that the account reconnects the user to the existing workspace.
- Form remains the primary interactive element.

### 5.3 Motion

- Intro line and headline reveal in sequence.
- Geometry rotates or translates only within a bounded range.
- Form enters after the headline with a short offset.
- Error feedback appears immediately without theatrical motion.

## 6. Signup design — Signal Cream

### 6.1 Layout

- Fixed black editorial header with `EGA HOUSE`, `AUTH / CREATE`, and a sign-in action.
- Cream grid background with red signal geometry and thin blue orbital lines.
- Two-column composition:
  - left: account-creation narrative and three compact operating benefits;
  - right: signup form integrated directly into the grid rather than floating in a glass panel.

### 6.2 Content hierarchy

- Study label: `AUTH 02 / CREATE / SIGNAL CREAM`.
- Headline: a concise message such as “Build your control room.”
- Existing value propositions remain, but are presented as numbered operational notes rather than rounded marketing cards.
- The confirmation-success state uses the same study frame and retains the email confirmation instructions.

### 6.3 Security and trust

- Turnstile remains functional and visible.
- Password guidance, validation, confirmation state, and trust statements remain intact.
- Security details are presented as structured metadata rather than decorative cards.

## 7. Form system

Shared form behavior:

- square or 2–4px radius fields and buttons;
- strong 1px structural borders;
- clear focus rings using citrus or signal red according to theme;
- persistent labels above fields;
- visible error text directly associated with the field;
- loading labels and spinners remain accessible;
- password visibility controls retain explicit accessible labels;
- no placeholder-only labeling;
- keyboard navigation and screen-reader order remain unchanged.

## 8. Motion and accessibility

- Use the existing Motion dependency for bounded entry and geometry effects.
- Avoid adding Lenis, GSAP, Three.js, or another animation engine.
- All transforms must use opacity and transform where possible.
- Respect `prefers-reduced-motion` and Motion reduced-motion settings.
- Reduced-motion mode removes parallax, orbital rotation, staggered entrances, and large scaling.
- Content remains visible and usable if JavaScript animation does not run.

## 9. Authentication contracts that must not change

- Authenticated users visiting `/login` or `/signup` redirect to `/dashboard`.
- Login retains safe `next` destination handling.
- Signup retains safe confirmation destination handling.
- Public signup URLs remain canonical.
- Supabase email/password authentication remains unchanged.
- Turnstile integration remains unchanged.
- Existing validation messages, focus management, and confirmation state remain semantically correct.

## 10. Testing and validation

Required automated checks:

- existing login navigation and form suites;
- existing signup validation, discovery, and form suites;
- new auth-shell and structural regression tests;
- homepage structure and preserved CTA tests;
- full repository test suite;
- TypeScript;
- scoped ESLint;
- production Next.js build;
- MCP integration CI.

Required visual checks:

- homepage at 1920×1080, 1440×900, 1280×800, tablet, and narrow mobile;
- login and signup at desktop and narrow mobile;
- 100%, 90%, and 80% browser zoom;
- keyboard-only navigation;
- reduced-motion mode;
- error, loading, and signup-success states.

## 11. Scope boundaries

In scope:

- homepage visual refinement;
- shared auth presentation architecture;
- login visual redesign;
- signup visual redesign;
- related tests and CI coverage.

Out of scope:

- authentication-provider changes;
- password-reset implementation;
- backend or database changes;
- dashboard redesign;
- new analytics or tracking;
- new animation libraries.
