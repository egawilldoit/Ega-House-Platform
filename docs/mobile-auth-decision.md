# Mobile Auth Model Decision

## Context

- Web app is Next.js at repo root and uses Supabase auth (`@supabase/ssr` + `@supabase/supabase-js`).
- Mobile app is Expo Router in `apps/mobile`.
- Mobile will use the existing Next.js backend as the primary API surface for app data.
- Current mobile auth in `apps/mobile` is an in-memory placeholder and not production-ready.

## Audit Findings (Current Web Auth)

### Where auth lives today

- Supabase browser client: `src/lib/supabase/client.ts`
- Supabase server client: `src/lib/supabase/server.ts`
- Cookie policy (domain/samesite/secure): `src/lib/supabase/cookie-options.ts`
- Auth gate + protected-domain routing: `src/middleware.ts`
- Login UI + password sign-in: `src/app/login/login-form.tsx`
- Login page server-side session check: `src/app/login/page.tsx`
- Logout server action path:
  - `src/components/layout/logout-actions.ts`
  - `src/components/layout/logout-logic.ts`
- Cross-subdomain auth/session e2e expectations: `tests/auth-session.e2e.spec.ts`

### What web auth does

1. Login page uses Supabase browser client and calls `supabase.auth.signInWithPassword(...)`.
2. Session is persisted via cookies managed by Supabase SSR helpers.
3. Middleware calls `createServerClient(...).auth.getClaims()` to validate/refresh session and protect:
   - root protected paths (`/dashboard`, `/goals`, `/tasks`, `/timer`, `/review`)
   - protected subdomains (`goals/tasks/timer/review.egawilldoit.online`)
4. Unauthenticated access is redirected to `/login` with `?next=...`.
5. Server pages and actions use `createClient()` from `src/lib/supabase/server.ts` so DB requests are owner-scoped through the authenticated Supabase session + RLS.
6. Logout is a server action calling `supabase.auth.signOut()`, then redirecting to `/login` (or root login host when signing out from protected subdomains).

### Key assumptions web relies on

- Session continuity is cookie-first and middleware-enforced.
- Production cookie domain is shared across subdomains (`.egawilldoit.online`), secure + sameSite lax.
- `src/app/api` currently has no dedicated mobile auth endpoints yet.

## Decision

**Mobile will use token/session exchange with secure native storage (not cookie-backed browser-style auth as the primary model).**

## Why This Decision

### Pros

- Fits native Expo runtime: avoids depending on browser cookie behavior and cross-domain cookie semantics.
- Gives explicit session lifecycle control in app code (boot restore, resume checks, 401 handling).
- Keeps Next.js as API boundary while still interoperating with Supabase-authenticated identity.
- Easier to harden over time (SecureStore + explicit refresh + consistent auth headers).

### Tradeoffs

- Requires mobile-side token persistence and refresh logic (extra client complexity).
- Requires minimal API contract work on Next.js side for mobile session exchange.

### Why not cookie-backed model for mobile

- Current cookie model is optimized for web + middleware + domain/subdomain cookies.
- Expo native fetch/cookie handling is not equivalent to browser session semantics, especially for predictable cross-domain/session middleware behavior.
- Relying on cookie transport in native increases ambiguity and operational risk versus explicit bearer/session handling.

## Session Lifecycle (Mobile)

1. **App launch**
   - Read persisted mobile session from secure storage.
   - If no valid session, set auth state to signed out.
2. **Session restore**
   - If stored session exists and is not expired, use it.
   - If near expiry or expired, attempt refresh.
3. **Login request**
   - Mobile sends credentials to a dedicated auth endpoint (or Supabase-backed exchange endpoint exposed by Next.js).
   - Server verifies and returns mobile session payload (access token + refresh token + expiry + user snapshot).
4. **Authenticated requests**
   - Mobile attaches `Authorization: Bearer <accessToken>` on API calls.
   - Backend resolves user identity from token/session and performs owner-scoped DB access.
5. **Refresh**
   - Attempt token refresh before expiry or on first 401 caused by expiry.
   - Persist refreshed session atomically.
6. **App resume / foreground**
   - Re-check expiry threshold; refresh if needed.
7. **Logout**
   - Call logout endpoint if defined, clear local session, clear in-memory auth state, navigate to public login/welcome.
8. **Expired session**
   - If refresh fails, clear local session and redirect to public auth flow.

## Expired Session Handling (Exact Behavior)

1. API returns `401` or client detects expired token.
2. Client attempts one refresh.
3. If refresh succeeds:
   - replay the failed request once with the new access token.
4. If refresh fails:
   - clear secure storage session,
   - clear in-memory auth state,
   - redirect user to public login screen,
   - do not keep user on protected routes.

## Storage / Cookie Behavior Decision

- Mobile stores auth session in secure native storage (Expo SecureStore in implementation phase).
- Store only what is required:
  - `accessToken`
  - `refreshToken`
  - `expiresAt` (unix seconds)
  - minimal user identity fields (optional convenience cache)
- Do **not** store web cookie artifacts in mobile storage.
- Do **not** rely on browser cookie middleware behavior for native authenticated requests.

## API Contract Direction (Mobile)

Initial contract direction for next implementation issues:

- `POST /api/mobile/auth/session`
  - Request: `{ email: string; password: string }`
  - Response `200`: `{ session: MobileAuthSession, user: MobileAuthUser }`
  - Response `401`: invalid credentials
- `POST /api/mobile/auth/refresh`
  - Request: `{ refreshToken: string }`
  - Response `200`: `{ session: MobileAuthSession, user?: MobileAuthUser }`
  - Response `401`: refresh invalid/expired
- `POST /api/mobile/auth/logout`
  - Request: authenticated (bearer token or refresh token, depending on final endpoint design)
  - Response `204`

Authenticated mobile API calls should use bearer auth (`Authorization` header), not cookie-dependent session assumptions.

## Minimal Scaffolding Added in This Issue

- `apps/mobile/types/auth.ts`:
  - shared `MobileAuthSession`, `MobileAuthUser`, and response/refresh types.
- `apps/mobile/lib/storage/session.ts`:
  - typed storage interface + in-memory fallback + TODO hooks for SecureStore.
- `apps/mobile/lib/api/auth.ts`:
  - typed API contract placeholders (`loginMobile`, `refreshMobileSession`, `logoutMobileSession`) for the agreed model.

## Recommended Next Steps

1. Add `/api/mobile/auth/session`, `/refresh`, `/logout` in Next.js.
2. Implement `SecureStoreSessionStorage` in mobile and wire it to auth context boot flow.
3. Replace temporary `signIn()/signOut()` in-memory behavior with real API calls + persisted session restore.
4. Add authenticated fetch wrapper with one-time refresh-on-401 retry.
5. Remove temporary demo login validation once real auth is connected.
