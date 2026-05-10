import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  GOOGLE_CALENDAR_OAUTH_STATE_COOKIE,
  buildGoogleCalendarAuthorizationUrl,
  createGoogleCalendarOAuthState,
  getGoogleCalendarOAuthEnv,
} from "@/app/api/integrations/google-calendar/oauth";

export async function GET() {
  const envResult = getGoogleCalendarOAuthEnv();

  if (envResult.errorMessage || !envResult.env) {
    return NextResponse.redirect(
      new URL(
        `/settings/account?${new URLSearchParams({
          error: envResult.errorMessage,
        }).toString()}`,
        process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000",
      ),
    );
  }

  const state = createGoogleCalendarOAuthState();
  const response = NextResponse.redirect(
    buildGoogleCalendarAuthorizationUrl(envResult.env, state),
  );
  const cookieStore = await cookies();
  const secure = envResult.env.redirectUri.startsWith("https://");

  cookieStore.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/api/integrations/google-calendar/callback",
    maxAge: 10 * 60,
  });
  response.cookies.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/api/integrations/google-calendar/callback",
    maxAge: 10 * 60,
  });

  return response;
}
