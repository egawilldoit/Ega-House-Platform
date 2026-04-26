import { NextResponse } from "next/server";

import {
  buildDailyAssistantEmail,
  isDailyAssistantEmailType,
  type DailyAssistantEmailType,
} from "@/lib/email/daily-assistant";
import { getEmailEnvConfig, getResendClient } from "@/lib/email/resend";

function missingEnvResponse(missing: string[]) {
  return NextResponse.json(
    { ok: false, error: `Missing required environment variable(s): ${missing.join(", ")}` },
    { status: 500 },
  );
}

function errorResponse(type: DailyAssistantEmailType | null, error: unknown, status = 500) {
  return NextResponse.json({ ok: false, type, error }, { status });
}

export async function POST(request: Request) {
  const envResult = getEmailEnvConfig();
  if (!envResult.ok) {
    return missingEnvResponse(envResult.missing);
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${envResult.config.cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type");

  if (!type || !isDailyAssistantEmailType(type)) {
    return errorResponse(type as DailyAssistantEmailType | null, "Unknown daily email type.", 400);
  }

  const email = buildDailyAssistantEmail(type);
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

  return NextResponse.json({ ok: true, type, id: data?.id });
}
