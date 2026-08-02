# Public Signup Flow Design

**Date:** 2026-08-02

**Branch:** `feat/public-signup`

**Status:** Written spec ready for review

## Goal

Ship a production-ready public signup flow for the EGA House web application using the existing Supabase Auth and shared cross-subdomain session architecture.

A new user must be able to:

1. Open `/signup` from the root domain.
2. Create an account with their name, email address, and password.
3. Receive a clear confirmation-email state without being told they are already signed in.
4. Confirm their email through an SSR-safe `/auth/confirm` route.
5. Land on the intended safe destination, defaulting to `/dashboard`.
6. Sign in later from the existing `/login` flow if they do not complete confirmation immediately.

## Product truth

- Signup is public and self-service.
- Email verification is required before first access.
- The application uses Supabase password authentication and cookie-based SSR sessions.
- The same authenticated session must continue to work across the EGA House root domain and protected workspace subdomains.
- No invitation code, social login, anonymous login, organization onboarding, billing flow, or profile-management flow is included.

## Research basis

The design follows current guidance from:

- Supabase password signup, PKCE email-confirmation, redirect URL, CAPTCHA, and production-checklist documentation.
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

### Shared redirect policy

Add a small pure auth URL utility used by login, signup, and confirmation. It must normalize and validate destinations without reading browser globals inside the pure validation function.

Allowed destinations:

- Relative paths beginning with one `/` and not `//`.
- `egawilldoit.online`.
- Any subdomain of `egawilldoit.online`.
- `localhost` and loopback hosts for development.

Reject unsupported schemes, malformed URLs, URL credentials, protocol-relative URLs, and all other hosts.

### Confirmation route

Add:

- `src/app/auth/confirm/route.ts`

The GET route:

1. Reads `token_hash`, `type`, and optional `next` query parameters.
2. Accepts only a safe destination from the shared redirect policy.
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
- Supabase project password settings must accept this application-level range.

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
- Do not add resend-email behavior in this release because it introduces separate rate-limit and abuse-handling requirements.

#### Immediate session

Production is designed for email confirmation, but Supabase can return a session when confirmation is disabled in another environment. If a valid session is returned, use the same safe redirect logic as login and continue to `/dashboard` or the safe `next` destination.

## Exact confirmation URL contract

The signup form always builds a full confirmation URL with a `next` query parameter, even when using the default destination:

```text
https://www.egawilldoit.online/auth/confirm?next=%2Fdashboard
```

The Supabase call passes that full URL as `emailRedirectTo`:

```ts
supabase.auth.signUp({
  email,
  password,
  options: {
    data: { full_name: fullName },
    emailRedirectTo: confirmationUrl,
    captchaToken,
  },
});
```

The Confirm signup email template must use the redirect URL directly and append the token parameters:

```html
<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">
  Confirm email address
</a>
```

This produces one unambiguous application callback URL:

```text
/auth/confirm?next=...&token_hash=...&type=email
```

The implementation must not combine a template that appends `/auth/confirm` with an `emailRedirectTo` value that already contains `/auth/confirm`.

The UI must not perform user-existence probing. Supabase intentionally obscures some existing-account responses when email confirmation is enabled. User-facing errors remain generic where needed.

## Bot and abuse protection

Public signup must support Supabase Auth CAPTCHA protection using Cloudflare Turnstile.

Implementation requirements:

- Read the public site key from `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- Render a managed Turnstile challenge near the submit action when the key is configured.
- Pass the resulting token as `options.captchaToken` to `signUp()`.
- Reset the challenge after a failed signup attempt.
- Block submission with a deployment-configuration message if production enables Supabase CAPTCHA but the frontend key is missing.
- Tests use a deterministic CAPTCHA adapter and never call Cloudflare.

Operational requirements:

- Configure the Turnstile secret in Supabase Auth's bot and abuse protection settings.
- Keep the managed challenge visually subordinate to the form.
- Do not use an intrusive image puzzle unless Turnstile determines a challenge is necessary.

Local development may omit the key only when CAPTCHA is also disabled in the linked local/test auth environment.

## Operational Supabase configuration gates

Before merge or production activation, verify in the `Ega-House-Platform` Supabase project:

1. Public email signup is enabled.
2. Confirm Email is enabled.
3. Site URL is the canonical production root URL.
4. Redirect URLs allow the canonical `/auth/confirm` URL, local development callbacks, and approved Vercel preview patterns used for auth testing.
5. The Confirm signup email template exactly follows the confirmation URL contract above.
6. Turnstile CAPTCHA protection and matching frontend/secret keys are configured.
7. Production SMTP is configured or explicitly accepted as a launch blocker; Supabase's built-in sender is rate-limited and best-effort.
8. Auth rate limits are reviewed for the expected launch traffic.

No secret key is added to client code. The existing Supabase publishable key and Turnstile public site key are the only browser credentials.

## Error handling

Map errors into stable user-facing categories:

- Missing Supabase or Turnstile environment values: deployment configuration message.
- Invalid email or password policy: field-level guidance.
- CAPTCHA incomplete or expired: ask the user to complete the security check again.
- Rate limit or email delivery problem: retry-later guidance without exposing internals.
- Existing-account ambiguity: `We could not create this account. Try signing in, or use another email.`
- Confirmation failure: return to login with a clear recovery message.
- Unexpected failure: generic message and preserve non-password field values.

Never render raw stack traces, keys, CAPTCHA tokens, token hashes, or confirmation parameters.

## Accessibility

- Every field has a visible label.
- Password reveal is a real button with a changing accessible name.
- Status feedback uses `role="status"`; blocking errors use `role="alert"` only after submission.
- Focus is moved deliberately to the error summary or success heading.
- Keyboard order follows visual order.
- Color is not the only error or success indicator.
- The Turnstile widget has an accessible surrounding label and does not disrupt keyboard flow.
- Motion follows the existing auth page behavior and respects `prefers-reduced-motion`.
- Text contrast remains accessible over the yellow/glass surface.

## Responsive behavior

Reuse the auth page's existing `960px` breakpoint:

- Desktop: product narrative and form in two columns with trust bar below.
- Tablet/mobile: one column, form directly after the introductory content.
- Inputs and buttons remain at least 44px high.
- Long email addresses and validation messages wrap without overflow.
- Turnstile fits within the form card without horizontal scrolling.
- No horizontal scrolling at 320px viewport width.

## Testing

### Unit and render contracts

Add focused tests for:

- Redirect allow-list and rejection behavior.
- Signup copy, labels, autocomplete attributes, password reveal, and absence of a confirm-password field.
- Validation for blank name, malformed email, short password, and overlong values.
- Supabase call payload including `full_name`, the exact confirmation URL, and CAPTCHA token.
- Confirmation-required success state.
- Immediate-session redirect behavior.
- Generic handling for existing-user ambiguity, CAPTCHA errors, and rate limits.
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

A Vercel preview for the exact final SHA must be `READY`. The visual review must cover desktop and mobile signup, validation, password reveal, CAPTCHA, and inbox-confirmation states.

## Database scope and known security advisory

Signup requires no public-schema migration. Supabase Auth stores the new account and metadata in the auth schema.

A separate audit found several existing public tables with RLS disabled. That issue is not modified in this signup branch because enabling RLS without complete owner-scoped policies could break current application behavior. It must be tracked and remediated as an independent security change.

## Non-goals

- Mobile-app signup.
- OAuth/social providers.
- Password reset.
- Confirmation email resend.
- Terms/privacy acceptance checkbox.
- Organization or team creation.
- Profile table or avatar setup.
- RLS remediation unrelated to signup.
