import { NextResponse } from "next/server";

import {
  authorizeCronRequest,
  missingCronEnvResponse,
} from "@/lib/cron/route-runtime";
import {
  buildDailyAssistantEmail,
  isDailyAssistantEmailType,
  type DailyAssistantEmailType,
} from "@/lib/email/daily-assistant";
import { getAssistantEmailData } from "@/lib/email/assistant-data";
import { getEmailEnvConfig, getResendClient } from "@/lib/email/resend";

function errorResponse(type: DailyAssistantEmailType | null, error: unknown, status = 500) {
  return NextResponse.json({ ok: false, type, error }, { status });
}

export async function POST(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;

  const envResult = getEmailEnvConfig();
  if (!envResult.ok) {
    return missingCronEnvResponse(envResult.missing);
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type");

  if (!type || !isDailyAssistantEmailType(type)) {
    return errorResponse(type as DailyAssistantEmailType | null, "Unknown daily email type.", 400);
  }

  let assistantData: Awaited<ReturnType<typeof getAssistantEmailData>>;
  try {
    assistantData = await getAssistantEmailData(type);
  } catch {
    return NextResponse.json(
      { ok: false, type, error: "Failed to load assistant email data" },
      { status: 500 },
    );
  }

  const email = buildDailyAssistantEmail(assistantData);
  const resend = getResendClient(envResult.config.resendApiKey);
  const { data, error } = await resend.emails.send({
    from: envResult.config.emailFrom,
    to: envResult.config.dailyAssistantEmail,
    subject: email.subject,
    html: email.html,
  });

  if (error) {
    return errorResponse(type, error);
  }

  return NextResponse.json({
    ok: true,
    type,
    id: data?.id,
    counts: assistantData.diagnostics.counts,
    skippedTables: assistantData.diagnostics.skippedTables,
  });
}
