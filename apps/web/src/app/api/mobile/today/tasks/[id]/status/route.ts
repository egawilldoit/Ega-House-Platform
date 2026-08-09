import { NextResponse } from "next/server";

import type { MobileApiErrorResponse, MobileTodayTaskStatusMutationResponse } from "@/lib/contracts/mobile";
import { updateTodayTaskStatus } from "@/lib/services/today-planner-service";
import { parseJsonRequestBody, validateMobileTodayStatusInput } from "@/lib/validation/mobile";
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

  const body = await parseJsonRequestBody(request);
  const validationResult = validateMobileTodayStatusInput(body);
  if (!validationResult.ok) {
    return NextResponse.json(validationResult.error as MobileApiErrorResponse, {
      status: validationResult.status,
    });
  }

  const { id } = await context.params;
  const result = await updateTodayTaskStatus(id, validationResult.data.status, {
    supabase: authResult.supabase,
  });

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
      status: validationResult.data.status,
    } satisfies MobileTodayTaskStatusMutationResponse,
    { status: 200 },
  );
}
