import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  GOOGLE_CALENDAR_OAUTH_STATE_COOKIE,
  exchangeGoogleCalendarCodeForTokens,
  getGoogleAccountEmailFromIdToken,
  getGoogleCalendarTokenEnv,
  getSettingsRedirectUrl,
  validateGoogleCalendarCallback,
} from "@/app/api/integrations/google-calendar/oauth";
import { connectGoogleCalendarWithTokens } from "@/lib/services/calendar-settings-service";

function redirectToSettings(
  request: Request,
  type: "success" | "error",
  message: string,
) {
  const response = NextResponse.redirect(
    getSettingsRedirectUrl(request.url, type, message),
  );
  response.cookies.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/integrations/google-calendar/callback",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE)?.value;
  const callbackResult = validateGoogleCalendarCallback(
    request.url,
    expectedState,
  );

  if (callbackResult.errorMessage || !callbackResult.code) {
    return redirectToSettings(
      request,
      "error",
      callbackResult.errorMessage ?? "Google Calendar OAuth callback failed.",
    );
  }

  const envResult = getGoogleCalendarTokenEnv();

  if (envResult.errorMessage || !envResult.env) {
    return redirectToSettings(request, "error", envResult.errorMessage);
  }

  const tokenResult = await exchangeGoogleCalendarCodeForTokens(
    callbackResult.code,
    envResult.env,
  );

  if (tokenResult.errorMessage || !tokenResult.data?.access_token) {
    return redirectToSettings(
      request,
        "error",
        tokenResult.errorMessage ?? "Google Calendar token exchange failed.",
    );
  }

  const storeResult = await connectGoogleCalendarWithTokens({
    accessToken: tokenResult.data.access_token,
    refreshToken: tokenResult.data.refresh_token,
    expiresInSeconds: tokenResult.data.expires_in,
    googleAccountEmail: getGoogleAccountEmailFromIdToken(tokenResult.data.id_token),
  });

  if (storeResult.errorMessage) {
    return redirectToSettings(request, "error", storeResult.errorMessage);
  }

  return redirectToSettings(
    request,
    "success",
    "Google Calendar connected.",
  );
}
