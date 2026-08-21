import { NextResponse } from "next/server";

import type {
  MobileApiErrorResponse,
  MobileTimerResponse,
  MobileTimerStartInput,
} from "@/lib/contracts/mobile";
import { startTimerForTask } from "@/lib/services/timer-service";
import { parseJsonRequestBody } from "@/lib/validation/mobile";
import { resolveMobileRequestAuth } from "@/app/api/mobile/_lib/auth";
import { getMobileTimerState, mobileErrorResponse } from "@/app/api/mobile/_lib/helpers";

function validateTimerStartInput(body: unknown): { ok: true; data: MobileTimerStartInput } | { ok: false; error: MobileApiErrorResponse; status: number } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      status: 400,
      error: {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Request body must be a JSON object.",
        },
      },
    };
  }

  const taskId = String((body as Record<string, unknown>).taskId ?? "").trim();
  if (!taskId) {
    return {
      ok: false,
      status: 400,
      error: {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "taskId is required.",
        },
      },
    };
  }

  return { ok: true, data: { taskId } };
}

export async function POST(request: Request) {
  const authResult = await resolveMobileRequestAuth(request);
  if (!authResult.ok) {
    return mobileErrorResponse(authResult.code, authResult.message, authResult.status);
  }

  const body = await parseJsonRequestBody(request);
  const validationResult = validateTimerStartInput(body);
  if (!validationResult.ok) {
    return NextResponse.json(validationResult.error as MobileApiErrorResponse, {
      status: validationResult.status,
    });
  }

  try {
    const startResult = await startTimerForTask(validationResult.data.taskId, {
      supabase: authResult.supabase,
    });

    if (startResult.errorMessage !== null) {
      return mobileErrorResponse("VALIDATION_ERROR", startResult.errorMessage, 400);
    }

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
      { status: 201 },
    );
  } catch (error) {
    return mobileErrorResponse(
      "INTERNAL_ERROR",
      "Unable to start the timer right now.",
      500,
      undefined,
      {
        cause: error,
        route: "/api/mobile/timer/start",
        operation: "POST",
      },
    );
  }
}
