# Wave 5 — MCP / OAuth / integrations / cron cleanup

## Goal
Reduce duplicated runtime/protocol glue without changing public routes, OAuth provider policy, MCP behavior, secrets, database schema, or operational side effects.

## Boundaries
- Keep `/api/mcp` as a thin Next adapter over the existing lazy MCP endpoint/runtime.
- Keep MCP bearer/claims validation protocol-specific.
- Keep Google Calendar OAuth state, callback, token exchange, scopes, redirect behavior, and failure redaction unchanged.
- Reuse Wave 3 verified identity for OAuth consent ownership.
- Centralize duplicated cron secret authorization and common missing-environment response mechanics.
- Preserve weekly-review compatibility aliases.
- No deploy, secret mutation, DB migration, service-role expansion, or Wave 4 Agent changes.

## TDD sequence
1. Add RED tests for shared cron authorization and missing-env responses.
2. Implement `cron/_lib/runtime.ts` and migrate cron routes without changing response shapes.
3. Add/extend OAuth consent tests proving shared verified identity ownership and existing redirect semantics.
4. Route OAuth decision ownership through Wave 3 identity service.
5. Add executable Wave 5 boundary proof for thin MCP route, lazy feature gate, Google OAuth callback/state protections, and cron helper adoption.
6. Run exact-head Unified Platform Validation; fix only observed regressions.
