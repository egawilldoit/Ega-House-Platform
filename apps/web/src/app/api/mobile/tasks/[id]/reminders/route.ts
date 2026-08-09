import { NextResponse } from "next/server";

import type { MobileTaskMutationResponse } from "@/lib/contracts/mobile";
import { createTaskEmailReminder } from "@/lib/services/task-service";
import { parseJsonRequestBody } from "@/lib/validation/mobile";
import { resolveMobileRequestAuth } from "@/app/api/mobile/_lib/auth";
import { getMobileTaskItemById, mobileErrorResponse } from "@/app/api/mobile/_lib/helpers";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function readRemindAt(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "";
  }

  return String((body as Record<string, unknown>).remindAt ?? "").trim();
}

export async function POST(request: Request, context: RouteContext) {
  const authResult = await resolveMobileRequestAuth(request);
  if (!authResult.ok) {
    return mobileErrorResponse(authResult.code, authResult.message, authResult.status);
  }

  const { id } = await context.params;
  const body = await parseJsonRequestBody(request);
  const reminderResult = await createTaskEmailReminder(
    {
      taskId: id,
      remindAt: readRemindAt(body),
      channel: "email",
      status: "pending",
    },
    { supabase: authResult.supabase },
  );

  if (reminderResult.errorMessage) {
    if (reminderResult.errorMessage.includes("not found") || reminderResult.errorMessage.includes("available")) {
      return mobileErrorResponse("NOT_FOUND", reminderResult.errorMessage, 404);
    }
    return mobileErrorResponse("VALIDATION_ERROR", reminderResult.errorMessage, 400);
  }

  const taskResult = await getMobileTaskItemById(authResult.supabase, id);
  if (taskResult.errorMessage || !taskResult.data) {
    return mobileErrorResponse("INTERNAL_ERROR", "Unable to load updated task.", 500);
  }

  return NextResponse.json(
    {
      ok: true,
      task: taskResult.data,
    } satisfies MobileTaskMutationResponse,
    { status: 201 },
  );
}
