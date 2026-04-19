import { NextResponse } from "next/server";

import type { MobileAuthErrorResponse } from "@/lib/contracts/mobile";
import { refreshMobileSession } from "@/lib/services/mobile-auth-service";
import { parseJsonRequestBody, validateMobileAuthRefreshRequest } from "@/lib/validation/mobile";

export async function POST(request: Request) {
  const body = await parseJsonRequestBody(request);
  const validationResult = validateMobileAuthRefreshRequest(body);

  if (!validationResult.ok) {
    return NextResponse.json(validationResult.error as MobileAuthErrorResponse, {
      status: validationResult.status,
    });
  }

  const refreshResult = await refreshMobileSession(validationResult.data.refreshToken);
  if (refreshResult.errorCode || !refreshResult.data) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: refreshResult.errorCode ?? "INTERNAL_ERROR",
          message: refreshResult.errorMessage ?? "Unable to refresh session right now.",
        },
      } satisfies MobileAuthErrorResponse,
      { status: refreshResult.status ?? 500 },
    );
  }

  return NextResponse.json(refreshResult.data, { status: 200 });
}
