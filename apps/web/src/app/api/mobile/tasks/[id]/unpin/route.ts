import { NextResponse } from "next/server";

import type { MobileTaskMutationResponse } from "@/lib/contracts/mobile";
import { unpinTaskInFocusQueue } from "@/lib/services/focus-queue-service";
import { resolveMobileRequestAuth } from "@/app/api/mobile/_lib/auth";
import { getMobileTaskItemById, mobileErrorResponse } from "@/app/api/mobile/_lib/helpers";

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

  const taskResult = await getMobileTaskItemById(authResult.supabase, id);
  if (taskResult.errorMessage || !taskResult.data) {
    return mobileErrorResponse("INTERNAL_ERROR", "Unable to load unpinned task.", 500);
  }

  return NextResponse.json(
    {
      ok: true,
      task: taskResult.data,
    } satisfies MobileTaskMutationResponse,
    { status: 200 },
  );
}
