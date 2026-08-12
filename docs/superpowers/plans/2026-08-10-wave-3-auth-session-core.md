# Wave 3 Auth/Session Consolidation Implementation Plan

**Goal:** Consolidate verified user identity and auth error semantics across web, Hono, and mobile without collapsing their transport-specific session mechanisms.

**Architecture:** Supabase remains token/session authority. Web keeps SSR cookies; mobile keeps bearer/refresh-token storage; Hono keeps bearer verification. Shared packages own only platform-neutral identity/error contracts and actor derivation. `@ega/api-client` adds exactly-one refresh-and-retry on authenticated 401 responses through an injected callback; it never owns token storage.

## Constraints
- Base is exact Wave 2 head `11e15d669382739eba248522af98281ac6056226`.
- No DB/schema, secrets, provider, cookie-policy, SecureStore, deployment, or production changes.
- Actor identity must always derive from a verified Supabase user/token.
- Mobile refresh can happen at most once per failed request.
- A terminal refresh failure must preserve existing mobile session-clear/onUnauthorized behavior.
- No retry loop and no hidden background session state in `@ega/api-client`.

## Tasks
1. Add platform-neutral `AuthenticatedIdentity` + auth error code contract in `@ega/contracts`, with tests.
2. Add application helper deriving `AuthenticatedActor` from shared verified identity, with tests.
3. Add TDD coverage in `@ega/api-client` for 401 → one refresh → one retry; terminal 401/no-refresh paths.
4. Implement injected `refreshAccessToken` support in HttpClient without storage ownership.
5. Update mobile `lib/api/ega.ts` to inject `refreshMobileSessionIfConfigured` as refresh callback rather than refreshing asynchronously from `onAuthError`.
6. Update web auth mapping to expose shared verified identity while keeping `requireAuthenticatedUser` compatibility.
7. Update Hono middleware actor construction to use the shared identity-to-actor helper after token verification.
8. Strengthen security proof for verified identity chain and run exact-head Unified Platform Validation including mobile/web/server/api-client.
9. Keep stacked PR unmerged/undeployed; record exact-head evidence and mark ready only when green.
