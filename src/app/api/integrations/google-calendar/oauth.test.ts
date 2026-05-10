import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGoogleCalendarAuthorizationUrl,
  exchangeGoogleCalendarCodeForTokens,
  getGoogleAccountEmailFromIdToken,
} from "./oauth";

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

test("Google Calendar id token email decode is optional and safe", () => {
  const payload = Buffer.from(JSON.stringify({ email: "owner@example.com" })).toString(
    "base64url",
  );

  assert.equal(getGoogleAccountEmailFromIdToken(`header.${payload}.signature`), "owner@example.com");
  assert.equal(getGoogleAccountEmailFromIdToken("not-a-jwt"), null);
});
