import { randomBytes } from "node:crypto";

export const GOOGLE_CALENDAR_OAUTH_STATE_COOKIE =
  "ega_google_calendar_oauth_state";

export type GoogleCalendarOAuthEnv = {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string;
};

export type GoogleCalendarTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
};

export function getGoogleCalendarOAuthEnv() {
  const env = {
    clientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI?.trim() ?? "",
    scopes: process.env.GOOGLE_CALENDAR_SCOPES?.trim() ?? "",
  };

  if (!env.clientId || !env.redirectUri || !env.scopes) {
    return {
      errorMessage:
        "Google Calendar OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI, and GOOGLE_CALENDAR_SCOPES.",
      env: null,
    };
  }

  return { errorMessage: null, env };
}

export function getGoogleCalendarTokenEnv() {
  const envResult = getGoogleCalendarOAuthEnv();

  if (envResult.errorMessage || !envResult.env) {
    return envResult;
  }

  if (!envResult.env.clientSecret) {
    return {
      errorMessage:
        "Google Calendar OAuth is not configured. Set GOOGLE_CLIENT_SECRET.",
      env: null,
    };
  }

  return { errorMessage: null, env: envResult.env as Required<GoogleCalendarOAuthEnv> };
}

export function createGoogleCalendarOAuthState() {
  return randomBytes(24).toString("base64url");
}

export function buildGoogleCalendarAuthorizationUrl(
  env: GoogleCalendarOAuthEnv,
  state: string,
) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("redirect_uri", env.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", env.scopes);
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  return url;
}

export async function exchangeGoogleCalendarCodeForTokens(
  code: string,
  env: Required<GoogleCalendarOAuthEnv>,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      redirect_uri: env.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as GoogleCalendarTokenResponse;

  if (!response.ok || !payload.access_token) {
    return {
      errorMessage:
        payload.error_description ??
        payload.error ??
        "Google Calendar token exchange failed.",
      data: null,
    };
  }

  return { errorMessage: null, data: payload };
}

export function getGoogleAccountEmailFromIdToken(idToken?: string) {
  const [, payload] = idToken?.split(".") ?? [];

  if (!payload) {
    return null;
  }

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as { email?: unknown };
    return typeof parsed.email === "string" ? parsed.email : null;
  } catch {
    return null;
  }
}
