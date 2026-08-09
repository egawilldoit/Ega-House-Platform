import { NextResponse } from "next/server";

import type { MobileAuthErrorResponse, MobileAuthLogoutResponse } from "@/lib/contracts/mobile";
import { logoutMobileSession } from "@/lib/services/mobile-auth-service";
import { getBearerTokenFromRequest } from "@/lib/validation/mobile";

export async function POST(request: Request) {
  const token = getBearerTokenFromRequest(request);
  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Missing bearer token.",
        },
      } satisfies MobileAuthErrorResponse,
      { status: 401 },
    );
  }

  const result = await logoutMobileSession(token);
  if (result.errorCode) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: result.errorCode,
          message: result.errorMessage ?? "Unable to logout right now.",
        },
      } satisfies MobileAuthErrorResponse,
      { status: result.status ?? 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
    } satisfies MobileAuthLogoutResponse,
    { status: 200 },
  );
}
