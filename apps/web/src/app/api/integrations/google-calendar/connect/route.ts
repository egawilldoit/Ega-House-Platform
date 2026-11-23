import { NextResponse } from "next/server";

import {
  GOOGLE_CALENDAR_OAUTH_RETURN_COOKIE,
  GOOGLE_CALENDAR_OAUTH_STATE_COOKIE,
  buildGoogleCalendarAuthorizationUrl,
  createGoogleCalendarOAuthState,
  getGoogleCalendarOAuthEnv,
  getGoogleCalendarReturnUrl,
  normalizeGoogleCalendarReturnPath,
} from "@/app/api/integrations/google-calendar/oauth";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnPath = normalizeGoogleCalendarReturnPath(
    requestUrl.searchParams.get("returnTo"),
  );
  const envResult = getGoogleCalendarOAuthEnv();

  if (envResult.errorMessage || !envResult.env) {
    return NextResponse.redirect(
      getGoogleCalendarReturnUrl(
        request.url,
        returnPath,
        "error",
        envResult.errorMessage,
      ),
    );
  }

  const state = createGoogleCalendarOAuthState();
  const response = NextResponse.redirect(
    buildGoogleCalendarAuthorizationUrl(envResult.env, state),
  );
  const secure = envResult.env.redirectUri.startsWith("https://");
  const cookiePath = "/api/integrations/google-calendar/callback";

  response.cookies.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: cookiePath,
    maxAge: 10 * 60,
  });
  response.cookies.set(GOOGLE_CALENDAR_OAUTH_RETURN_COOKIE, returnPath, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: cookiePath,
    maxAge: 10 * 60,
  });

  return response;
}
