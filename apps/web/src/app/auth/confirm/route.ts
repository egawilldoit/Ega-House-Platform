import type { EmailOtpType } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { resolveSafeAuthDestination } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/server";

const EMAIL_OTP_TYPES = new Set<EmailOtpType>([
  "email",
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
]);

function confirmationFailureUrl(request: NextRequest) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", "confirmation_failed");
  return url;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const code = searchParams.get("code");
  const destination = resolveSafeAuthDestination(
    searchParams.get("next"),
    request.nextUrl.origin,
  );
  const supabase = await createClient();

  if (tokenHash && rawType && EMAIL_OTP_TYPES.has(rawType as EmailOtpType)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: rawType as EmailOtpType,
    });

    return NextResponse.redirect(
      error ? confirmationFailureUrl(request) : destination,
    );
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return NextResponse.redirect(
      error ? confirmationFailureUrl(request) : destination,
    );
  }

  return NextResponse.redirect(confirmationFailureUrl(request));
}
