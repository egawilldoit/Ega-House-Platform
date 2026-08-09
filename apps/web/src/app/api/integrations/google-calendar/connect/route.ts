import { NextResponse } from "next/server";

import {
  GOOGLE_CALENDAR_OAUTH_STATE_COOKIE,
  buildGoogleCalendarAuthorizationUrl,
  createGoogleCalendarOAuthState,
  getGoogleCalendarOAuthEnv,
  getSettingsRedirectUrl,
} from "@/app/api/integrations/google-calendar/oauth";

export async function GET(request: Request) {
  const envResult = getGoogleCalendarOAuthEnv();

  if (envResult.errorMessage || !envResult.env) {
    return NextResponse.redirect(
      getSettingsRedirectUrl(request.url, "error", envResult.errorMessage),
    );
  }

  const state = createGoogleCalendarOAuthState();
  const response = NextResponse.redirect(
    buildGoogleCalendarAuthorizationUrl(envResult.env, state),
  );
  const secure = envResult.env.redirectUri.startsWith("https://");

  response.cookies.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/api/integrations/google-calendar/callback",
    maxAge: 10 * 60,
  });

  return response;
}
