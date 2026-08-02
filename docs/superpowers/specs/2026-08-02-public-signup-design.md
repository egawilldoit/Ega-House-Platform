# Public Signup Flow Design

**Date:** 2026-08-02

**Branch:** `feat/public-signup`

**Status:** Approved direction; awaiting written-spec review

## Goal

Ship a production-ready public signup flow for the EGA House web application using the existing Supabase Auth and shared cross-subdomain session architecture.

A new user must be able to:

1. Open `/signup` from the root domain.
2. Create an account with their name, email address, and password.
3. Receive a clear confirmation-email state without being told they are already signed in.
4. Confirm their email through an SSR-safe `/auth/confirm` route.
5. Land on the intended safe destination, defaulting to `/dashboard`.
6. Sign in later from the existing `/login` flow if they do not complete the confirmation flow immediately.

## Product truth

- Signup is public and self-service.
- Email verification is required before first access.
- The application uses Supabase password authentication and cookie-based SSR sessions.
- The same authenticated session must continue to work across the EGA House root domain and protected workspace subdomains.
- No invitation code, social login, anonymous login, organization onboarding, billing flow, or profile-management flow is included.

## Research basis

The design follows current guidance from:

- Supabase password signup and PKCE email-confirmation documentation.
- Supabase redirect URL configuration guidance for production, local development, and Vercel previews.
- W3C WAI form validation and notification guidance.
- GOV.UK password-input research for show/hide controls and avoiding duplicate password fields.
- NIST and OWASP guidance favoring password length and passphrases over arbitrary character-composition rules.

## Selected approach

Use a dedicated `/signup` route rather than a mode toggle inside `/login`.

The route will share a presentational auth shell with the existing login page so both pages remain visually consistent without duplicating the current large inline style block. Login behavior remains unchanged.

## Architecture

### Shared presentation

Create a small auth presentation layer under the existing app tree:

- `src/app/_components/auth/AuthExperienceShell.tsx`
- `src/app/_components/auth/auth-experience.css`

The shell owns only presentation:

- Root background, noise, responsive grid, left-side product message, form-card container, and trust bar.
- Shared form primitives such as labels, inputs, password reveal controls, alerts, buttons, and helper text.
- No Supabase calls, redirects, form state, or route-specific copy.

Refactor the existing `LoginForm` to render inside this shell while preserving its current sign-in logic, safe redirect behavior, and visual content.

### Signup route

Add:

- `src/app/signup/page.tsx`
- `src/app/signup/signup-form.tsx`

`page.tsx` is a Server Component that:

- Creates the existing Supabase server client.
- Redirects an already authenticated user to `/dashboard`.
- Exports signup-specific metadata.
- Renders the client form inside `Suspense` because the form reads the `next` query parameter.

`signup-form.tsx` is a Client Component that owns form state and calls `supabase.auth.signUp()`.

### Confirmation route

Add:

- `src/app/auth/confirm/route.ts`

The GET route:

1. Reads `token_hash`, `type`, and optional `next` query parameters.
2. Accepts only a safe internal path or an approved EGA House/localhost URL.
3. Uses the existing server Supabase client to call `verifyOtp()`.
4. Redirects successful confirmations to the safe destination, defaulting to `/dashboard`.
5. Redirects failures to `/login?error=confirmation_failed` without preserving secret confirmation parameters.

The route must not redirect to arbitrary external origins.

## Signup form UX

### Information hierarchy

The signup page retains the current premium EGA House auth language but changes the route-specific content:

- Eyebrow: `Create account`
- Title: `Build your control room`
- Supporting copy: `Create one secure account for your dashboard, goals, tasks, timer, and weekly review.`
- Primary button: `Create my workspace`
- Secondary text link: `Already have an account? Sign in`

### Fields

Use exactly three required fields:

1. **Your name**
   - `autocomplete="name"`
   - Stored as Supabase `full_name` user metadata.
   - Trimmed before submission.
   - Maximum 100 characters.

2. **Email**
   - `type="email"`
   - `autocomplete="email"`
   - Normalized with `trim().toLowerCase()` before submission.

3. **Password**
   - Hidden by default.
   - `autocomplete="new-password"`.
   - A distinct `Show password` / `Hide password` button.
   - Paste remains enabled for password-manager compatibility.
   - No confirm-password field.

### Password policy

For this first release:

- Minimum 12 characters.
- Maximum 128 characters in the UI.
- Spaces and printable Unicode characters are accepted.
- No uppercase, lowercase, digit, or symbol composition rules.
- Requirements are shown before entry, not only after an error.

The UI will describe this as: `Use at least 12 characters. A short passphrase works well.`

### Validation behavior

- Native `required`, email, length, and autocomplete attributes are present.
- Custom validation runs on submit and after a field has been touched; it does not show errors on every keystroke.
- The first invalid field receives focus after submission.
- Each error appears next to its field and is associated using `aria-describedby` and `aria-invalid`.
- A concise form-level error summary appears above the form for submission failures.
- Errors explain how to recover rather than only stating that something is wrong.

### Submission states

#### Idle

All fields are editable and the primary action is enabled when not submitting.

#### Submitting

- Inputs and submit button are disabled.
- Button text becomes `Creating account…` with a spinner.
- Duplicate submissions are prevented.

#### Confirmation required

Replace the form card content with a success panel:

- Heading: `Check your inbox`
- Message names the submitted email address.
- Explain that the account is not active until the email is confirmed.
- Provide `Back to sign in` and `Use a different email` actions.
- Do not auto-redirect or imply an active session.
- Do not add resend-email behavior in this release because it introduces rate-limit and abuse handling that should be designed separately.

#### Immediate session

Although production is designed for email confirmation, Supabase can return a session when confirmation is disabled in another environment. If a valid session is returned, use the same safe redirect logic as login and continue to `/dashboard` or the safe `next` destination.

## Supabase call

Call:

```ts
supabase.auth.signUp({
  email,
  password,
  options: {
    data: { full_name: fullName },
    emailRedirectTo: confirmationUrl,
  },
});
```

`confirmationUrl` points to the current root origin `/auth/confirm` route and carries only a sanitized internal `next` value.

The UI must not perform user-existence probing. Supabase intentionally obscures some existing-account responses when email confirmations are enabled. User-facing errors remain generic where needed.

## Redirect safety

Move the current login redirect parser into a small shared auth utility so login, signup, and confirmation use one policy.

Allowed destinations:

- Relative paths beginning with one `/` and not `//`.
- `egawilldoit.online`.
- Any subdomain of `egawilldoit.online`.
- `localhost` for development.

Reject unsupported schemes, malformed URLs, credentials in URLs, and all other hosts.

## Operational Supabase configuration gates

Before merge or production activation, verify in the `Ega-House-Platform` Supabase project:

1. Public email signup is enabled.
2. Confirm Email is enabled.
3. Site URL is the canonical production root URL.
4. Redirect URLs include:
   - Canonical production `/auth/confirm` destinations.
   - Local development callback URLs.
   - Approved Vercel preview patterns when preview email flows are tested.
5. The Confirm signup email template sends `token_hash` and `type=email` to `/auth/confirm`.
6. Production SMTP is configured or explicitly accepted as a launch risk; Supabase's built-in sender is rate-limited and best-effort.

No secret key is added to client code. The existing publishable key remains the only browser credential.

## Error handling

Map errors into stable user-facing categories:

- Missing Supabase environment values: deployment configuration message.
- Invalid email or password policy: field-level guidance.
- Rate limit or email delivery problem: retry-later guidance without exposing internals.
- Existing-account ambiguity: `We could not create this account. Try signing in, or use another email.`
- Confirmation failure: return to login with a clear recovery message.
- Unexpected failure: generic message and preserve non-password field values.

Never render raw stack traces, keys, token hashes, or confirmation parameters.

## Accessibility

- Every field has a visible label.
- Password reveal is a real button with a changing accessible name.
- Status feedback uses `role="status"`; blocking errors use `role="alert"` only after submission.
- Focus is moved deliberately to the error summary or success heading.
- Keyboard order follows visual order.
- Color is not the only error or success indicator.
- Motion follows the existing auth page behavior and respects `prefers-reduced-motion`.
- Text contrast remains accessible over the yellow/glass surface.

## Responsive behavior

Reuse the auth page's existing `960px` breakpoint:

- Desktop: product narrative and form in two columns with trust bar below.
- Tablet/mobile: one column, form directly after the introductory content.
- Inputs and buttons remain at least 44px high.
- Long email addresses and validation messages wrap without overflow.
- No horizontal scrolling at 320px viewport width.

## Testing

### Unit and render contracts

Add focused tests for:

- Redirect allow-list and rejection behavior.
- Signup copy, labels, autocomplete attributes, password reveal, and absence of confirm-password field.
- Validation for blank name, malformed email, short password, and overlong values.
- Supabase call payload including `full_name` metadata and confirmation URL.
- Confirmation-required success state.
- Immediate-session redirect behavior.
- Generic handling for existing-user ambiguity and rate limits.
- Confirmation route success, failure, missing parameters, and unsafe `next` values.
- Existing login behavior after shared-shell extraction.

### Repository verification

Before PR merge, run:

```bash
npm test -- src/app/signup
npm test -- src/app/login
npm test -- src/app/auth/confirm
npm test
npm run typecheck
npm run lint
npm run build
```

A Vercel preview for the exact final SHA must be `READY`. The visual review must cover desktop and mobile signup, validation, password reveal, and inbox-confirmation states.

## Database scope and known security advisory

Signup requires no public-schema migration. Supabase Auth stores the new account and metadata in the auth schema.

A separate audit found several existing public tables with RLS disabled. That issue is not modified in this signup branch because enabling RLS without complete owner-scoped policies could break current application behavior. It must be tracked and remediated as an independent security change.

## Non-goals

- Mobile-app signup.
- OAuth/social providers.
- Password reset.
- Confirmation email resend.
- CAPTCHA or bot challenge.
- Terms/privacy acceptance checkbox.
- Organization or team creation.
- Profile table or avatar setup.
- RLS remediation unrelated to signup.
