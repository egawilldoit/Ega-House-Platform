import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  GOOGLE_CALENDAR_OAUTH_STATE_COOKIE,
  exchangeGoogleCalendarCodeForTokens,
  getGoogleAccountEmailFromIdToken,
  getGoogleCalendarTokenEnv,
} from "@/app/api/integrations/google-calendar/oauth";
import { connectGoogleCalendarWithTokens } from "@/lib/services/calendar-settings-service";

function getSettingsRedirectUrl(request: Request, type: "success" | "error", message: string) {
  const url = new URL("/settings/account", request.url);
  url.searchParams.set(type, message);
  return url;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const error = requestUrl.searchParams.get("error");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE)?.value;

  cookieStore.delete(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE);

  if (error) {
    return NextResponse.redirect(
      getSettingsRedirectUrl(request, "error", `Google Calendar OAuth failed: ${error}`),
    );
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(
      getSettingsRedirectUrl(request, "error", "Google Calendar OAuth state was invalid."),
    );
  }

  const envResult = getGoogleCalendarTokenEnv();

  if (envResult.errorMessage || !envResult.env) {
    return NextResponse.redirect(
      getSettingsRedirectUrl(request, "error", envResult.errorMessage),
    );
  }

  const tokenResult = await exchangeGoogleCalendarCodeForTokens(code, envResult.env);

  if (tokenResult.errorMessage || !tokenResult.data?.access_token) {
    return NextResponse.redirect(
      getSettingsRedirectUrl(
        request,
        "error",
        tokenResult.errorMessage ?? "Google Calendar token exchange failed.",
      ),
    );
  }

  const storeResult = await connectGoogleCalendarWithTokens({
    accessToken: tokenResult.data.access_token,
    refreshToken: tokenResult.data.refresh_token,
    expiresInSeconds: tokenResult.data.expires_in,
    googleAccountEmail: getGoogleAccountEmailFromIdToken(tokenResult.data.id_token),
  });

  if (storeResult.errorMessage) {
    return NextResponse.redirect(
      getSettingsRedirectUrl(request, "error", storeResult.errorMessage),
    );
  }

  return NextResponse.redirect(
    getSettingsRedirectUrl(request, "success", "Google Calendar connected."),
  );
}
