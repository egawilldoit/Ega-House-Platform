# Google Calendar OAuth QA

Production deploys must set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GOOGLE_CALENDAR_SCOPES`; `GOOGLE_CALENDAR_ID` is optional and defaults to `primary`.

After changing any of those Vercel environment variables, redeploy before testing Connect Calendar. Google Cloud Console must list the exact `GOOGLE_REDIRECT_URI` as an authorized redirect URI.

## Connect URL checklist

The Connect Google Calendar redirect must include:

- `response_type=code`
- `redirect_uri` equal to exact production `GOOGLE_REDIRECT_URI`
- `state`
- `access_type=offline`
- `include_granted_scopes=true`
- `prompt=consent`
- `scope` from `GOOGLE_CALENDAR_SCOPES`

## Callback failure codes

Settings renders safe `errorCode` values from callback failures:

- `google_error`: Google returned an OAuth error.
- `state_mismatch`: Browser callback state did not match stored state cookie.
- `missing_code`: Google callback lacked authorization code.
- `token_exchange_failed`: Server-side exchange with Google token endpoint failed.
- `missing_refresh_token`: Google returned access token without refresh token.
- `settings_write_failed`: Token response arrived, but Calendar settings persistence failed.
- `unexpected`: Unclassified server-side callback failure.

Server logs use `google_calendar_oauth_callback_failed` with step-level diagnostics only. Do not log tokens, auth codes, secrets, cookies, redirect URIs, or full callback URLs.
