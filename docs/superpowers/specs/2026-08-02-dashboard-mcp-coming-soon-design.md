# Dashboard MCP Coming Soon Announcement — Design

**Date:** 2026-08-02

**Branch:** `feat/dashboard-mcp-coming-soon`

**Status:** Approved — persistent announcement

## Goal

Add a prominent, persistent announcement to `/dashboard` that tells users EGA House MCP access is coming soon without implying that the production integration is already enabled.

## Product truth

The repository already contains an OAuth-protected, owner-scoped, read-only MCP implementation. Production activation is still gated and staged. The announcement must therefore use future-facing language and must not promise a launch date.

The first release is described as allowing approved AI clients to securely read the authenticated user's EGA House projects, goals, and tasks. It must not advertise write access.

## Selected approach

Render a dedicated `McpComingSoonAnnouncement` component directly above the existing dashboard hero.

The announcement is persistent and has no dismiss control. It uses the dashboard's existing green signal palette, rounded card geometry, subtle gradients, and Lucide icons. It remains visually distinct from operational health panels so users understand it is a product announcement rather than a live system state.

## Content

- Eyebrow: `MCP · COMING SOON`
- Heading: `Connect your AI to EGA House.`
- Body: `Soon, approved AI clients will be able to securely read your projects, goals, and tasks through an OAuth-protected EGA House connection.`
- Capability chips:
  - `Owner-scoped access`
  - `Read-only at launch`
  - `Built for MCP clients`
- Supporting note: `Your workspace stays private. Access is granted per user and per approved client.`

## Component boundary

Create `src/app/dashboard/_components/McpComingSoonAnnouncement.tsx` as a presentational server-compatible React component with no state, storage, network calls, or feature flags.

Integrate it in `src/app/dashboard/page.tsx` inside `#dashboard-main`, immediately before the Hero panel.

## Accessibility

- Use a semantic `<aside>` for supplementary announcement content.
- Associate the heading through `aria-labelledby`.
- Keep decorative icons hidden from assistive technology.
- Maintain readable contrast and responsive wrapping.
- Do not use `role="alert"` or `aria-live`; the announcement is persistent page content, not a newly triggered notification.

## Testing

Add a static-render test using `renderToStaticMarkup` that verifies:

1. The coming-soon status and heading render.
2. The copy names projects, goals, and tasks.
3. OAuth protection, owner-scoped access, and read-only launch positioning render.
4. No dismiss control is present.

Run the focused test, full Vitest suite, TypeScript typecheck, ESLint, and Next.js production build through repository CI.

## Non-goals

- No MCP activation or environment-variable changes.
- No OAuth or database changes.
- No launch date.
- No dismiss state or local storage.
- No new dependencies.
- No navigation link to an integration page until a public documentation route exists.
