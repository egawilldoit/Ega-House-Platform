import { NextResponse } from "next/server";

import type { MobileTodayTaskMutationResponse } from "@/lib/contracts/mobile";
import { removeTaskFromToday } from "@/lib/services/today-planner-service";
import { resolveMobileRequestAuth } from "@/app/api/mobile/_lib/auth";
import { mobileErrorResponse } from "@/app/api/mobile/_lib/helpers";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const authResult = await resolveMobileRequestAuth(request);
  if (!authResult.ok) {
    return mobileErrorResponse(authResult.code, authResult.message, authResult.status);
  }

  const { id } = await context.params;
  const result = await removeTaskFromToday(id, { supabase: authResult.supabase });
  if (result.errorMessage) {
    if (result.errorMessage.includes("unavailable")) {
      return mobileErrorResponse("NOT_FOUND", result.errorMessage, 404);
    }
    if (result.errorMessage.startsWith("Unable to")) {
      return mobileErrorResponse("INTERNAL_ERROR", result.errorMessage, 500);
    }

    return mobileErrorResponse("VALIDATION_ERROR", result.errorMessage, 400);
  }

  return NextResponse.json(
    {
      ok: true,
      taskId: id,
    } satisfies MobileTodayTaskMutationResponse,
    { status: 200 },
  );
}
