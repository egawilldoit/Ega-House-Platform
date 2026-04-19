## EGA-238 Complete: Mobile Auth Model Decision

### What was audited

- Web auth implementation across:
  - `src/middleware.ts`
  - `src/lib/supabase/client.ts`
  - `src/lib/supabase/server.ts`
  - `src/lib/supabase/cookie-options.ts`
  - `src/app/login/login-form.tsx`
  - `src/app/login/page.tsx`
  - `src/components/layout/logout-actions.ts`
  - `src/components/layout/logout-logic.ts`
  - `tests/auth-session.e2e.spec.ts`
- Findings confirm web is cookie-backed Supabase SSR auth with middleware protection and cross-subdomain cookie sharing in production.

### Chosen mobile auth model

- **Token/session exchange with secure native storage** (primary model), not cookie-backed browser-style auth.

### Session lifecycle (agreed)

- Boot: restore session from secure storage.
- Login: exchange credentials via dedicated mobile auth endpoint.
- Auth requests: bearer token in `Authorization` header.
- Refresh: attempt pre-expiry and on first 401.
- Expired/invalid refresh: clear local session and redirect to login/welcome.
- Logout: call logout endpoint, clear local session, move to public auth route.

### Expired-session handling

- On 401: refresh once.
- If refresh succeeds: retry original request once.
- If refresh fails: clear storage + auth state, redirect to login.

### Storage/cookie decision

- Mobile stores session (`accessToken`, `refreshToken`, `expiresAt`) in secure native storage (SecureStore in next issue).
- Mobile does not rely on web cookie middleware semantics for auth.

### What was added now

- Decision doc: `docs/mobile-auth-decision.md`
- Typed mobile auth scaffolding:
  - `apps/mobile/types/auth.ts`
  - `apps/mobile/lib/storage/session.ts`
  - `apps/mobile/lib/api/auth.ts`
- Temporary auth context annotated for replacement:
  - `apps/mobile/lib/auth/auth-context.tsx`

### Remaining implementation issues

- Build Next.js mobile auth endpoints:
  - `POST /api/mobile/auth/session`
  - `POST /api/mobile/auth/refresh`
  - `POST /api/mobile/auth/logout`
- Wire Expo SecureStore-backed session persistence.
- Replace temporary in-memory auth shell with real endpoint-driven flow.
- Add shared authenticated-fetch wrapper with refresh/retry-once behavior.
