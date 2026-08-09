import { NextResponse } from "next/server";

import type { MobileAuthErrorResponse } from "@/lib/contracts/mobile";
import { signInMobileWithPassword } from "@/lib/services/mobile-auth-service";
import { parseJsonRequestBody, validateMobileAuthSessionRequest } from "@/lib/validation/mobile";

export async function POST(request: Request) {
  const body = await parseJsonRequestBody(request);
  const validationResult = validateMobileAuthSessionRequest(body);

  if (!validationResult.ok) {
    return NextResponse.json(validationResult.error as MobileAuthErrorResponse, {
      status: validationResult.status,
    });
  }

  const authResult = await signInMobileWithPassword(
    validationResult.data.email,
    validationResult.data.password,
  );

  if (authResult.errorCode || !authResult.data) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: authResult.errorCode ?? "INTERNAL_ERROR",
          message: authResult.errorMessage ?? "Unable to authenticate right now.",
        },
      } satisfies MobileAuthErrorResponse,
      { status: authResult.status ?? 500 },
    );
  }

  return NextResponse.json(authResult.data, { status: 200 });
}
