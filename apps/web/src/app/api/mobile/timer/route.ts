import { NextResponse } from "next/server";

import type { MobileTimerResponse } from "@/lib/contracts/mobile";
import { resolveMobileRequestAuth } from "@/app/api/mobile/_lib/auth";
import { getMobileTimerState, mobileErrorResponse } from "@/app/api/mobile/_lib/helpers";

export async function GET(request: Request) {
  const authResult = await resolveMobileRequestAuth(request);
  if (!authResult.ok) {
    return mobileErrorResponse(authResult.code, authResult.message, authResult.status);
  }

  try {
    const stateResult = await getMobileTimerState(authResult.supabase);
    if (stateResult.errorMessage || !stateResult.data) {
      return mobileErrorResponse(
        "INTERNAL_ERROR",
        stateResult.errorMessage ?? "Unable to load the timer workspace right now.",
        500,
      );
    }

    return NextResponse.json(
      {
        ok: true,
        timer: stateResult.data,
      } satisfies MobileTimerResponse,
      { status: 200 },
    );
  } catch (error) {
    return mobileErrorResponse(
      "INTERNAL_ERROR",
      "Unable to load the timer workspace right now.",
      500,
      undefined,
      {
        cause: error,
        route: "/api/mobile/timer",
        operation: "GET",
      },
    );
  }
}
