import { NextResponse } from "next/server";

import type { MobileTaskMutationResponse } from "@/lib/contracts/mobile";
import { pinTaskInFocusQueue } from "@/lib/services/focus-queue-service";
import { getTaskById } from "@/lib/services/task-service";
import { resolveMobileRequestAuth } from "@/app/api/mobile/_lib/auth";
import { mapTaskRecordToMobileTaskItem, mobileErrorResponse } from "@/app/api/mobile/_lib/helpers";

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
  const pinResult = await pinTaskInFocusQueue(id, { supabase: authResult.supabase });
  if (pinResult.errorMessage) {
    if (pinResult.errorMessage.includes("unavailable")) {
      return mobileErrorResponse("NOT_FOUND", pinResult.errorMessage, 404);
    }
    return mobileErrorResponse("VALIDATION_ERROR", pinResult.errorMessage, 400);
  }

  const taskResult = await getTaskById(id, { supabase: authResult.supabase });
  if (taskResult.errorMessage || !taskResult.data) {
    return mobileErrorResponse("INTERNAL_ERROR", "Unable to load pinned task.", 500);
  }

  return NextResponse.json(
    {
      ok: true,
      task: mapTaskRecordToMobileTaskItem(taskResult.data, 0),
    } satisfies MobileTaskMutationResponse,
    { status: 200 },
  );
}
