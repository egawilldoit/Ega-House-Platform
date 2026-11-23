import { NextResponse } from "next/server";

import {
  continueWebCalendarSync,
  getWebCalendarSyncStatus,
  startWebCalendarSync,
} from "@/lib/services/calendar-sync-engine";

export const dynamic = "force-dynamic";

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const result = await getWebCalendarSyncStatus(origin);

  if (!result.ok) {
    return jsonResponse({ ok: false, error: result.errorMessage }, result.status);
  }

  return jsonResponse({ ok: true, status: result.data });
}

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  let body: { action?: unknown; runId?: unknown; retryMode?: unknown } = {};

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ ok: false, error: "A JSON request body is required." }, 400);
  }

  const action = String(body.action ?? "").trim();

  if (action === "continue") {
    const runId = String(body.runId ?? "").trim();
    if (!runId) {
      return jsonResponse({ ok: false, error: "A Calendar sync run id is required." }, 400);
    }
    const result = await continueWebCalendarSync(origin, runId);
    if (!result.ok) {
      return jsonResponse({ ok: false, error: result.errorMessage }, result.status);
    }
    return jsonResponse({ ok: true, status: result.data });
  }

  if (action === "start" || action === "retry") {
    const result = await startWebCalendarSync(origin, {
      retryMode: action === "retry" || body.retryMode === true,
    });
    if (!result.ok) {
      return jsonResponse(
        {
          ok: false,
          error: result.errorMessage,
          reason: "reason" in result ? result.reason : undefined,
        },
        result.status,
      );
    }
    return jsonResponse({ ok: true, status: result.data });
  }

  return jsonResponse(
    { ok: false, error: "Use start, retry, or continue." },
    400,
  );
}
