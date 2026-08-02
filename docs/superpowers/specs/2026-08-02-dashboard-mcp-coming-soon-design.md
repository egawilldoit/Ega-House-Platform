# Dashboard MCP Coming Soon Announcement — Premium Light Redesign

**Date:** 2026-08-02

**Branch:** `feat/dashboard-mcp-coming-soon`

**Status:** Approved for implementation

## Goal

Replace the dark-green MCP announcement with a premium, lighter card that deliberately separates itself from the dark Command Center panel while remaining native to the EGA House dashboard.

The card announces future AI-to-workspace connectivity without protocol jargon and without suggesting that the capability is already enabled.

## Product truth

The first release is planned as approved, owner-scoped, read-only access to projects, goals, and tasks. Production activation remains gated. The UI must therefore:

- Use `Coming soon` language.
- Avoid a launch date or countdown.
- Avoid toggles, active indicators, primary buttons, or connection controls.
- Avoid advertising write access.
- State that nothing changes until the user chooses to connect an approved AI tool.

## Selected visual direction

Use a warm off-white/pale-mint surface between the dashboard background and its white task cards. The card uses existing EGA House tokens for foreground, accent, radius, shadow, spacing, and badges.

The card must not repeat the dark forest-green treatment used by the Command Center. Forest green is retained for headline and icon continuity only.

### Surface

- Background: layered pale mint and warm off-white using existing app colors.
- Border: one-pixel transparent border painted with a soft mint gradient.
- Shadow: existing `--shadow-card`.
- Radius: `calc(var(--radius-card) + 0.25rem)`.
- Texture: low-opacity dot grid across the card.
- Glow: one localized radial glow behind the secure gateway node only.

## Content hierarchy

### Top row

- Left: `NEW IN EGA HOUSE` using the existing active `Badge` style.
- Right: `Coming soon` using `StatusBadge` with the existing muted status treatment.

### Headline

`Your workspace is about to become AI-connected.`

Use the existing display font and dark forest foreground color.

### Supporting copy

`Approved AI tools will soon be able to read your projects, goals, and tasks directly. Nothing changes until you choose to connect one.`

The copy is result-first and contains no protocol terminology.

## Connection flow

The signature visual is a semantic three-node flow:

`AI clients → Secure gateway → Projects · Goals · Tasks`

- Desktop: horizontal grid with directional connectors.
- Mobile: vertical stack with downward connectors.
- Nodes use dashboard-native glass/pill styling.
- Only the first connector animates: a small signal travels from AI clients toward the secure gateway.
- `prefers-reduced-motion: reduce` freezes the signal while preserving the line and direction.
- The gateway alone receives a low-opacity accent glow.

## Trust row

Render three compact chips using the existing muted `Badge` style:

- `OAuth protected` with a lock icon.
- `Scoped to your account` with a user icon.
- `Read-only first release` with an eye icon.

No CTA or documentation link is included. A link would introduce a navigation promise before a public integration guide exists.

## Component boundaries

- `McpComingSoonAnnouncement.tsx`: semantic, stateless server-compatible markup and existing badge primitives.
- `dashboard.css`: dashboard-scoped surface, connection-flow, responsive, and reduced-motion styles.
- `McpComingSoonAnnouncement.test.tsx`: copy, semantic, non-live-state, and CSS motion-contract checks.
- `page.tsx`: unchanged integration point above the current dashboard hero.

No backend, data fetching, storage, feature flag, dependency, or client component is required.

## Accessibility

- Keep the card as a semantic `<aside>` labelled by its heading.
- Expose the connection flow as one descriptive image-equivalent label instead of reading decorative arrows individually.
- Hide decorative icons, texture, glow, connector arrows, and moving signal from assistive technology.
- Do not use `role="alert"` or `aria-live`.
- Maintain high contrast for all text against the pale surface.
- Preserve a useful static visual when reduced motion is requested.

## Responsive behavior

Use the same `768px` breakpoint already present in dashboard styles:

- Reduce card padding.
- Stack connection nodes vertically.
- Rotate connector direction downward.
- Allow top-row and trust chips to wrap without overflow.

## Testing

The focused render contract must verify:

1. New badge, status, headline, and result-first copy.
2. All three flow nodes.
3. All three trust indicators.
4. Semantic flow description.
5. Absence of buttons, toggles, active/live language, launch dates, and dismiss controls.
6. Dashboard CSS includes the signal animation and reduced-motion override.

Full repository test, typecheck, lint, and production build remain required before merge.
