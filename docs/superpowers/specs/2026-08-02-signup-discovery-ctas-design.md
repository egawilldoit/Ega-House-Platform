# Signup Discovery CTA Design

**Date:** 2026-08-02

**Branch:** `feat/signup-discovery-ctas`

**Status:** Approved for implementation

## Goal

Make public account creation easy to discover from every high-intent unauthenticated entry point while preserving the existing sign-in flow.

## Canonical destination

Every new or updated signup link points to:

`https://www.egawilldoit.online/signup`

When the login page contains a safe `next` destination, append it as an encoded `next` query parameter so signup and confirmation can return the user to the intended EGA House surface.

## Approved surfaces

### 1. Login header

Keep the existing top-right `New here? Create an account` prompt, but use the canonical absolute signup URL.

### 2. Login form

Add a visible account-creation prompt directly below the sign-in form:

- Supporting copy: `New to EGA House?`
- Link text: `Create your account`
- Preserve the safe `next` query supplied by the login page.
- Keep sign-in as the primary action.

### 3. Homepage hero

Keep `Enter workspace` as the existing-user action and add a visually distinct secondary CTA:

- Link text: `Create account`
- Destination: canonical signup URL.
- Supporting text should explain that signup creates the user's EGA House workspace.

### 4. How-it-works completion CTA

After the four-step `How it works` sequence, add a compact conversion panel:

- Eyebrow: `Ready to start?`
- Heading: `Turn the workflow into your workspace.`
- Supporting copy: `Create your EGA House account and move from goals to focused execution in one place.`
- Primary link: `Create your account`
- Secondary link: `Sign in instead`

## Accessibility and interaction

- Use descriptive link text that identifies the destination or action without relying on surrounding context.
- Use links, not buttons, because each CTA navigates to another page.
- Maintain visible keyboard focus states and existing color contrast conventions.
- Do not open a new tab.
- Do not add modal signup, tracking scripts, or new dependencies.

## Testing

Add focused tests that verify:

- The canonical signup URL is used by the login header, login form, homepage hero, and How-it-works CTA.
- The login page preserves and encodes `next` when creating the signup URL.
- Link text is descriptive and the existing `Enter workspace` and sign-in paths remain present.
- The path-scoped Public Signup CI runs the focused test, typecheck, lint, and production build when the homepage changes.
