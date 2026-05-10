# Google Calendar OAuth QA

Production deploys must set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GOOGLE_CALENDAR_SCOPES`; `GOOGLE_CALENDAR_ID` is optional and defaults to `primary`.

After changing any of those Vercel environment variables, redeploy before testing Connect Calendar. Google Cloud Console must list the exact `GOOGLE_REDIRECT_URI` as an authorized redirect URI.
