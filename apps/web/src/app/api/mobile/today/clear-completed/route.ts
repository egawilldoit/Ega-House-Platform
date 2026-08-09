import { NextResponse } from "next/server";

import type { MobileTodayClearCompletedResponse } from "@/lib/contracts/mobile";
import { clearCompletedFromToday } from "@/lib/services/today-planner-service";
import { resolveMobileRequestAuth } from "@/app/api/mobile/_lib/auth";
import { mobileErrorResponse } from "@/app/api/mobile/_lib/helpers";

export async function POST(request: Request) {
  const authResult = await resolveMobileRequestAuth(request);
  if (!authResult.ok) {
    return mobileErrorResponse(authResult.code, authResult.message, authResult.status);
  }

  const result = await clearCompletedFromToday({
    supabase: authResult.supabase,
  });

  if (result.errorMessage) {
    return mobileErrorResponse("INTERNAL_ERROR", result.errorMessage, 500);
  }

  return NextResponse.json(
    {
      ok: true,
    } satisfies MobileTodayClearCompletedResponse,
    { status: 200 },
  );
}
