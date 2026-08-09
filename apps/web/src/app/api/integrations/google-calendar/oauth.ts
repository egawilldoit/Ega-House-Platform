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

export type GoogleCalendarOAuthFailureCode =
  | "google_error"
  | "state_mismatch"
  | "missing_code"
  | "token_exchange_failed"
  | "missing_refresh_token"
  | "settings_write_failed"
  | "unexpected";

export type GoogleCalendarCallbackValidationResult =
  | {
      errorCode: Extract<
        GoogleCalendarOAuthFailureCode,
        "google_error" | "state_mismatch" | "missing_code"
      >;
      errorMessage: string;
      code: null;
    }
  | { errorCode: null; errorMessage: null; code: string };

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

export function getSettingsRedirectUrl(
  requestUrl: string,
  type: "success" | "error",
  message: string,
  errorCode?: GoogleCalendarOAuthFailureCode,
) {
  const url = new URL("/settings/account", requestUrl);
  url.searchParams.set(type, message);
  if (type === "error" && errorCode) {
    url.searchParams.set("errorCode", errorCode);
  }
  return url;
}

export function getGoogleCalendarOAuthFailureMessage(
  errorCode: GoogleCalendarOAuthFailureCode | null | undefined,
  fallback?: string | null,
) {
  switch (errorCode) {
    case "google_error":
      return "Google rejected the Calendar connection. Retry consent and confirm Calendar access is approved.";
    case "state_mismatch":
      return "Google Calendar connection expired or did not match this browser session. Start Connect again from this page.";
    case "missing_code":
      return "Google did not return an authorization code. Start Connect again and complete the consent screen.";
    case "token_exchange_failed":
      return "Google Calendar token exchange failed. Check production OAuth client ID, client secret, and exact redirect URI.";
    case "missing_refresh_token":
      return "Google did not return offline Calendar access. Reconnect and approve consent again.";
    case "settings_write_failed":
      return "Google Calendar connected with Google, but EGA could not save the connection. Retry after checking database access.";
    case "unexpected":
      return "Google Calendar connection failed before completion. Check server logs for the safe failure step.";
    default:
      return fallback ?? null;
  }
}

const SENSITIVE_DIAGNOSTIC_KEY_PATTERN =
  /(code|token|secret|authorization|cookie|url|uri)/i;

export type GoogleCalendarOAuthDiagnosticValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | GoogleCalendarOAuthDiagnosticValue[]
  | { [key: string]: GoogleCalendarOAuthDiagnosticValue };

export function redactGoogleCalendarOAuthDiagnostic(
  value: GoogleCalendarOAuthDiagnosticValue,
): GoogleCalendarOAuthDiagnosticValue {
  if (Array.isArray(value)) {
    return value.map((item) => redactGoogleCalendarOAuthDiagnostic(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_DIAGNOSTIC_KEY_PATTERN.test(key) && typeof entry === "string"
        ? "[redacted]"
        : redactGoogleCalendarOAuthDiagnostic(entry),
    ]),
  );
}

export function logGoogleCalendarOAuthFailure(
  errorCode: GoogleCalendarOAuthFailureCode,
  details: Record<string, GoogleCalendarOAuthDiagnosticValue>,
  logger: Pick<typeof console, "warn"> = console,
) {
  const safeDetails = redactGoogleCalendarOAuthDiagnostic(details) as Record<
    string,
    GoogleCalendarOAuthDiagnosticValue
  >;

  logger.warn("google_calendar_oauth_callback_failed", {
    errorCode,
    ...safeDetails,
  });
}

export function validateGoogleCalendarCallback(
  requestUrl: string,
  expectedState: string | null | undefined,
): GoogleCalendarCallbackValidationResult {
  const url = new URL(requestUrl);
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (error) {
    return {
      errorCode: "google_error",
      errorMessage: `Google Calendar OAuth failed: ${
        errorDescription || error
      }`,
      code: null,
    };
  }

  if (!code) {
    return {
      errorCode: "missing_code",
      errorMessage: "Google Calendar OAuth callback did not include a code.",
      code: null,
    };
  }

  if (!state || !expectedState || state !== expectedState) {
    return {
      errorCode: "state_mismatch",
      errorMessage: "Google Calendar OAuth state was invalid.",
      code: null,
    };
  }

  return { errorCode: null, errorMessage: null, code };
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
