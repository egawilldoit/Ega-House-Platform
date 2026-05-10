import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGoogleCalendarAuthorizationUrl,
  exchangeGoogleCalendarCodeForTokens,
  getGoogleAccountEmailFromIdToken,
  getGoogleCalendarOAuthEnv,
  getGoogleCalendarTokenEnv,
  validateGoogleCalendarCallback,
} from "./oauth";

function withEnv(
  values: Record<string, string | undefined>,
  run: () => void,
) {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("Google Calendar connect redirect includes required OAuth params", () => {
  const url = buildGoogleCalendarAuthorizationUrl(
    {
      clientId: "client-1",
      redirectUri: "https://app.example.com/api/integrations/google-calendar/callback",
      scopes: "https://www.googleapis.com/auth/calendar.events",
    },
    "state-123",
  );

  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("client_id"), "client-1");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://app.example.com/api/integrations/google-calendar/callback",
  );
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/calendar.events");
  assert.equal(url.searchParams.get("state"), "state-123");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("include_granted_scopes"), "true");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("response_type"), "code");
});

test("Google Calendar callback token exchange posts required request shape", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Response.json({
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
    });
  };

  const result = await exchangeGoogleCalendarCodeForTokens(
    "code-1",
    {
      clientId: "client-1",
      clientSecret: "secret-1",
      redirectUri: "https://app.example.com/callback",
      scopes: "calendar",
    },
    fetchMock as typeof fetch,
  );

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.access_token, "access-1");
  assert.equal(calls[0]?.url, "https://oauth2.googleapis.com/token");
  assert.equal(calls[0]?.init.method, "POST");
  const body = calls[0]?.init.body as URLSearchParams;
  assert.equal(body.get("code"), "code-1");
  assert.equal(body.get("client_id"), "client-1");
  assert.equal(body.get("client_secret"), "secret-1");
  assert.equal(body.get("redirect_uri"), "https://app.example.com/callback");
  assert.equal(body.get("grant_type"), "authorization_code");
});

test("Google Calendar env validation reports missing connect settings", () => {
  withEnv(
    {
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_REDIRECT_URI: "https://app.example.com/callback",
      GOOGLE_CALENDAR_SCOPES: "calendar",
    },
    () => {
      const result = getGoogleCalendarOAuthEnv();
      assert.equal(
        result.errorMessage,
        "Google Calendar OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI, and GOOGLE_CALENDAR_SCOPES.",
      );
      assert.equal(result.env, null);
    },
  );
});

test("Google Calendar env validation reports missing token secret", () => {
  withEnv(
    {
      GOOGLE_CLIENT_ID: "client-1",
      GOOGLE_CLIENT_SECRET: undefined,
      GOOGLE_REDIRECT_URI: "https://app.example.com/callback",
      GOOGLE_CALENDAR_SCOPES: "calendar",
    },
    () => {
      const result = getGoogleCalendarTokenEnv();
      assert.equal(
        result.errorMessage,
        "Google Calendar OAuth is not configured. Set GOOGLE_CLIENT_SECRET.",
      );
      assert.equal(result.env, null);
    },
  );
});

test("Google Calendar callback validation handles denied OAuth", () => {
  const result = validateGoogleCalendarCallback(
    "https://app.example.com/api/integrations/google-calendar/callback?error=access_denied&error_description=User%20denied%20access",
    "state-1",
  );

  assert.deepEqual(result, {
    errorMessage: "Google Calendar OAuth failed: User denied access",
    code: null,
  });
});

test("Google Calendar callback validation rejects state mismatch", () => {
  const result = validateGoogleCalendarCallback(
    "https://app.example.com/api/integrations/google-calendar/callback?code=code-1&state=bad-state",
    "state-1",
  );

  assert.deepEqual(result, {
    errorMessage: "Google Calendar OAuth state was invalid.",
    code: null,
  });
});

test("Google Calendar callback validation rejects missing code", () => {
  const result = validateGoogleCalendarCallback(
    "https://app.example.com/api/integrations/google-calendar/callback?state=state-1",
    "state-1",
  );

  assert.deepEqual(result, {
    errorMessage: "Google Calendar OAuth callback did not include a code.",
    code: null,
  });
});

test("Google Calendar id token email decode is optional and safe", () => {
  const payload = Buffer.from(JSON.stringify({ email: "owner@example.com" })).toString(
    "base64url",
  );

  assert.equal(getGoogleAccountEmailFromIdToken(`header.${payload}.signature`), "owner@example.com");
  assert.equal(getGoogleAccountEmailFromIdToken("not-a-jwt"), null);
});
