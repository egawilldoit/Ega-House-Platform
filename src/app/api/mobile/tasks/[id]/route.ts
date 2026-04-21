import { NextResponse } from "next/server";

import type { MobileApiErrorResponse, MobileTaskMutationResponse } from "@/lib/contracts/mobile";
import { getTaskById, updateTaskInline, validateTaskInlineUpdateInput } from "@/lib/services/task-service";
import { parseJsonRequestBody, validateUpdateTaskInput } from "@/lib/validation/mobile";
import { resolveMobileRequestAuth } from "@/app/api/mobile/_lib/auth";
import { mapTaskRecordToMobileTaskItem, mobileErrorResponse } from "@/app/api/mobile/_lib/helpers";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const authResult = await resolveMobileRequestAuth(request);
  if (!authResult.ok) {
    return mobileErrorResponse(authResult.code, authResult.message, authResult.status);
  }

  const { id } = await context.params;
  const taskResult = await getTaskById(id, { supabase: authResult.supabase });
  if (taskResult.errorMessage) {
    return mobileErrorResponse("INTERNAL_ERROR", taskResult.errorMessage, 500);
  }
  if (!taskResult.data) {
    return mobileErrorResponse("NOT_FOUND", "Task not found.", 404);
  }

  return NextResponse.json(
    {
      ok: true,
      task: mapTaskRecordToMobileTaskItem(taskResult.data, 0),
    } satisfies MobileTaskMutationResponse,
    { status: 200 },
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await resolveMobileRequestAuth(request);
  if (!authResult.ok) {
    return mobileErrorResponse(authResult.code, authResult.message, authResult.status);
  }

  const { id } = await context.params;
  const existingResult = await getTaskById(id, { supabase: authResult.supabase });
  if (existingResult.errorMessage) {
    return mobileErrorResponse("INTERNAL_ERROR", existingResult.errorMessage, 500);
  }
  if (!existingResult.data) {
    return mobileErrorResponse("NOT_FOUND", "Task not found.", 404);
  }

  const body = await parseJsonRequestBody(request);
  const validationResult = validateUpdateTaskInput(body);
  if (!validationResult.ok) {
    return NextResponse.json(validationResult.error as MobileApiErrorResponse, {
      status: validationResult.status,
    });
  }

  const merged = {
    taskId: existingResult.data.id,
    status: validationResult.data.status ?? existingResult.data.status,
    priority: validationResult.data.priority ?? existingResult.data.priority,
    dueDate:
      validationResult.data.dueDate === undefined
        ? existingResult.data.due_date
        : validationResult.data.dueDate,
    estimateMinutes:
      validationResult.data.estimateMinutes === undefined
        ? existingResult.data.estimate_minutes
        : validationResult.data.estimateMinutes,
    blockedReason:
      validationResult.data.blockedReason === undefined
        ? existingResult.data.blocked_reason
        : validationResult.data.blockedReason,
  };

  const inlineValidation = validateTaskInlineUpdateInput(merged);
  if (inlineValidation.errorMessage || !inlineValidation.data) {
    return mobileErrorResponse(
      "VALIDATION_ERROR",
      inlineValidation.errorMessage ?? "Task update request is invalid.",
      400,
    );
  }

  const updateResult = await updateTaskInline(inlineValidation.data, {
    supabase: authResult.supabase,
  });
  if (updateResult.errorMessage) {
    return mobileErrorResponse("INTERNAL_ERROR", updateResult.errorMessage, 500);
  }

  if (validationResult.data.description !== undefined) {
    const { error } = await authResult.supabase
      .from("tasks")
      .update({
        description: validationResult.data.description,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingResult.data.id);

    if (error) {
      return mobileErrorResponse("INTERNAL_ERROR", "Unable to update task description right now.", 500);
    }
  }

  const updatedResult = await getTaskById(existingResult.data.id, {
    supabase: authResult.supabase,
  });
  if (updatedResult.errorMessage || !updatedResult.data) {
    return mobileErrorResponse("INTERNAL_ERROR", "Unable to load updated task.", 500);
  }

  return NextResponse.json(
    {
      ok: true,
      task: mapTaskRecordToMobileTaskItem(updatedResult.data, 0),
    } satisfies MobileTaskMutationResponse,
    { status: 200 },
  );
}
