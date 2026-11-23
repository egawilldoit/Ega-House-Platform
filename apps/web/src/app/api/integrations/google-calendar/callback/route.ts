import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  GOOGLE_CALENDAR_OAUTH_RETURN_COOKIE,
  GOOGLE_CALENDAR_OAUTH_STATE_COOKIE,
  type GoogleCalendarOAuthFailureCode,
  exchangeGoogleCalendarCodeForTokens,
  fetchGoogleAccountIdentity,
  getGoogleAccountIdentityFromIdToken,
  getGoogleCalendarReturnUrl,
  getGoogleCalendarTokenEnv,
  getGoogleCalendarOAuthFailureMessage,
  logGoogleCalendarOAuthFailure,
  normalizeGoogleCalendarReturnPath,
  validateGoogleCalendarCallback,
} from "@/app/api/integrations/google-calendar/oauth";
import { connectGoogleCalendarWithTokens } from "@/lib/services/calendar-settings-service";

function redirectToReturn(
  request: Request,
  returnPath: "/settings" | "/tasks",
  type: "success" | "error",
  message: string,
  errorCode?: GoogleCalendarOAuthFailureCode,
) {
  const response = NextResponse.redirect(
    getGoogleCalendarReturnUrl(request.url, returnPath, type, message, errorCode),
  );
  const cookiePath = "/api/integrations/google-calendar/callback";
  response.cookies.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: cookiePath,
    maxAge: 0,
  });
  response.cookies.set(GOOGLE_CALENDAR_OAUTH_RETURN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: cookiePath,
    maxAge: 0,
  });
  return response;
}

export async function GET(request: Request) {
  let returnPath: "/settings" | "/tasks" = "/settings";
  try {
    const cookieStore = await cookies();
    const expectedState = cookieStore.get(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE)?.value;
    returnPath = normalizeGoogleCalendarReturnPath(
      cookieStore.get(GOOGLE_CALENDAR_OAUTH_RETURN_COOKIE)?.value,
    );
    const callbackUrl = new URL(request.url);
    const callbackResult = validateGoogleCalendarCallback(
      request.url,
      expectedState,
    );

    if (callbackResult.errorMessage || !callbackResult.code) {
      const errorCode = callbackResult.errorCode ?? "unexpected";
      logGoogleCalendarOAuthFailure(errorCode, {
        step: "callback_validation",
        googleError: callbackUrl.searchParams.get("error"),
        hasCode: callbackUrl.searchParams.has("code"),
        hasReturnedState: callbackUrl.searchParams.has("state"),
        hasExpectedState: Boolean(expectedState),
      });
      return redirectToReturn(
        request,
        returnPath,
        "error",
        getGoogleCalendarOAuthFailureMessage(errorCode) ??
          "Google Calendar OAuth callback failed.",
        errorCode,
      );
    }

    const envResult = getGoogleCalendarTokenEnv();

    if (envResult.errorMessage || !envResult.env) {
      logGoogleCalendarOAuthFailure("unexpected", {
        step: "token_env",
        hasClientId: Boolean(process.env.GOOGLE_CLIENT_ID?.trim()),
        hasClientSecret: Boolean(process.env.GOOGLE_CLIENT_SECRET?.trim()),
        hasRedirectUri: Boolean(process.env.GOOGLE_REDIRECT_URI?.trim()),
        hasScopes: Boolean(process.env.GOOGLE_CALENDAR_SCOPES?.trim()),
      });
      return redirectToReturn(
        request,
        returnPath,
        "error",
        getGoogleCalendarOAuthFailureMessage("unexpected") ??
          "Google Calendar OAuth callback failed.",
        "unexpected",
      );
    }

    const tokenResult = await exchangeGoogleCalendarCodeForTokens(
      callbackResult.code,
      envResult.env,
    );

    if (tokenResult.errorMessage || !tokenResult.data?.access_token) {
      logGoogleCalendarOAuthFailure("token_exchange_failed", {
        step: "token_exchange",
        providerError: tokenResult.errorMessage,
        hasAccessToken: Boolean(tokenResult.data?.access_token),
        hasRefreshToken: Boolean(tokenResult.data?.refresh_token),
      });
      return redirectToReturn(
        request,
        returnPath,
        "error",
        getGoogleCalendarOAuthFailureMessage("token_exchange_failed") ??
          "Google Calendar token exchange failed.",
        "token_exchange_failed",
      );
    }

    if (!tokenResult.data.refresh_token?.trim()) {
      logGoogleCalendarOAuthFailure("missing_refresh_token", {
        step: "token_response",
        hasAccessToken: Boolean(tokenResult.data.access_token),
        hasRefreshToken: false,
        hasExpiresIn: typeof tokenResult.data.expires_in === "number",
        hasIdToken: Boolean(tokenResult.data.id_token),
      });
      return redirectToReturn(
        request,
        returnPath,
        "error",
        getGoogleCalendarOAuthFailureMessage("missing_refresh_token") ??
          "Google Calendar did not return a refresh token.",
        "missing_refresh_token",
      );
    }

    let identity = getGoogleAccountIdentityFromIdToken(tokenResult.data.id_token);
    if (!identity.subject || !identity.email) {
      const profile = await fetchGoogleAccountIdentity(
        tokenResult.data.access_token,
      );
      identity = {
        email: identity.email ?? profile.email,
        subject: identity.subject ?? profile.subject,
      };
    }
    const storeResult = await connectGoogleCalendarWithTokens({
      accessToken: tokenResult.data.access_token,
      refreshToken: tokenResult.data.refresh_token,
      expiresInSeconds: tokenResult.data.expires_in,
      googleAccountEmail: identity.email,
      googleAccountSubject: identity.subject,
    });

    if (storeResult.errorMessage) {
      logGoogleCalendarOAuthFailure("settings_write_failed", {
        step: "settings_write",
        serviceError: storeResult.errorMessage,
      });
      return redirectToReturn(
        request,
        returnPath,
        "error",
        getGoogleCalendarOAuthFailureMessage("settings_write_failed") ??
          "Unable to connect Google Calendar right now.",
        "settings_write_failed",
      );
    }

    return redirectToReturn(
      request,
      returnPath,
      "success",
      "Google Calendar connected.",
    );
  } catch (error) {
    logGoogleCalendarOAuthFailure("unexpected", {
      step: "unexpected",
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return redirectToReturn(
      request,
      returnPath,
      "error",
      getGoogleCalendarOAuthFailureMessage("unexpected") ??
        "Google Calendar OAuth callback failed.",
      "unexpected",
    );
  }
}
