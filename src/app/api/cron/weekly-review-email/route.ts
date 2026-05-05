import { NextResponse } from "next/server";

import { getEmailEnvConfig, getResendClient } from "@/lib/email/resend";
import {
  createWeeklyReviewEmailSupabaseAdapter,
  deliverWeeklyReviewEmails,
} from "@/lib/services/weekly-review-email-service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

function missingEnvResponse(missing: string[]) {
  return NextResponse.json(
    { ok: false, error: `Missing required environment variable(s): ${missing.join(", ")}` },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return missingEnvResponse(["CRON_SECRET"]);
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const envResult = getEmailEnvConfig();
  if (!envResult.ok) {
    return missingEnvResponse(envResult.missing);
  }

  const ownerUserId = process.env.EGA_OWNER_USER_ID;
  if (!ownerUserId) {
    return missingEnvResponse(["EGA_OWNER_USER_ID"]);
  }

  try {
    const supabase = getSupabaseServiceClient();
    const adapter = createWeeklyReviewEmailSupabaseAdapter(supabase as never);
    const result = await deliverWeeklyReviewEmails({
      ...adapter,
      ownerUserIds: [ownerUserId],
      resend: getResendClient(envResult.config.resendApiKey),
      from: envResult.config.emailFrom,
      to: envResult.config.dailyAssistantEmail,
      appUrl: process.env.APP_URL,
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to deliver weekly review emails." },
      { status: 500 },
    );
  }
}
