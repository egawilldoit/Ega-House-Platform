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
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const rawType = request.nextUrl.searchParams.get("type");
  const destination = resolveSafeAuthDestination(
    request.nextUrl.searchParams.get("next"),
    request.nextUrl.origin,
  );

  if (!tokenHash || !rawType || !EMAIL_OTP_TYPES.has(rawType as EmailOtpType)) {
    return NextResponse.redirect(confirmationFailureUrl(request));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: rawType as EmailOtpType,
  });

  if (error) {
    return NextResponse.redirect(confirmationFailureUrl(request));
  }

  return NextResponse.redirect(destination);
}
