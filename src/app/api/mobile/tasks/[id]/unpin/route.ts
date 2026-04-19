import { NextResponse } from "next/server";

import type { MobileTaskMutationResponse } from "@/lib/contracts/mobile";
import { unpinTaskInFocusQueue } from "@/lib/services/focus-queue-service";
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
  const unpinResult = await unpinTaskInFocusQueue(id, { supabase: authResult.supabase });
  if (unpinResult.errorMessage) {
    if (unpinResult.errorMessage.includes("unavailable")) {
      return mobileErrorResponse("NOT_FOUND", unpinResult.errorMessage, 404);
    }
    return mobileErrorResponse("VALIDATION_ERROR", unpinResult.errorMessage, 400);
  }

  const taskResult = await getTaskById(id, { supabase: authResult.supabase });
  if (taskResult.errorMessage || !taskResult.data) {
    return mobileErrorResponse("INTERNAL_ERROR", "Unable to load unpinned task.", 500);
  }

  return NextResponse.json(
    {
      ok: true,
      task: mapTaskRecordToMobileTaskItem(taskResult.data, 0),
    } satisfies MobileTaskMutationResponse,
    { status: 200 },
  );
}
