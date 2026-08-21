import { NextResponse } from "next/server";

import type {
  MobileApiErrorResponse,
  MobileTimerStopInput,
  MobileTimerStopResponse,
} from "@/lib/contracts/mobile";
import { stopTimerSession } from "@/lib/services/timer-service";
import { parseJsonRequestBody } from "@/lib/validation/mobile";
import { resolveMobileRequestAuth } from "@/app/api/mobile/_lib/auth";
import { getMobileTimerState, mobileErrorResponse } from "@/app/api/mobile/_lib/helpers";

function validateTimerStopInput(body: unknown): { ok: true; data: MobileTimerStopInput } | { ok: false; error: MobileApiErrorResponse; status: number } {
  if (body === null || body === undefined) {
    return { ok: true, data: {} };
  }

  if (typeof body !== "object" || Array.isArray(body)) {
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

  const rawSessionId = (body as Record<string, unknown>).sessionId;
  if (rawSessionId !== undefined && rawSessionId !== null && typeof rawSessionId !== "string") {
    return {
      ok: false,
      status: 400,
      error: {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "sessionId must be a string.",
        },
      },
    };
  }

  return { ok: true, data: { sessionId: rawSessionId ?? null } };
}

export async function POST(request: Request) {
  const authResult = await resolveMobileRequestAuth(request);
  if (!authResult.ok) {
    return mobileErrorResponse(authResult.code, authResult.message, authResult.status);
  }

  const body = await parseJsonRequestBody(request);
  const validationResult = validateTimerStopInput(body);
  if (!validationResult.ok) {
    return NextResponse.json(validationResult.error as MobileApiErrorResponse, {
      status: validationResult.status,
    });
  }

  try {
    const stopResult = await stopTimerSession({
      sessionId: validationResult.data.sessionId ?? undefined,
      supabase: authResult.supabase,
    });

    if (stopResult.errorMessage !== null) {
      return mobileErrorResponse("VALIDATION_ERROR", stopResult.errorMessage, 400);
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
        stoppedTaskId: stopResult.stoppedTaskId,
        timer: stateResult.data,
      } satisfies MobileTimerStopResponse,
      { status: 200 },
    );
  } catch (error) {
    return mobileErrorResponse(
      "INTERNAL_ERROR",
      "Unable to stop the timer right now.",
      500,
      undefined,
      {
        cause: error,
        route: "/api/mobile/timer/stop",
        operation: "POST",
      },
    );
  }
}
