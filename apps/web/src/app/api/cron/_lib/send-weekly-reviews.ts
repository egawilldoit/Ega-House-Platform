import { NextResponse } from "next/server";

import { getEmailEnvConfig, getResendClient } from "@/lib/email/resend";
import {
  createWeeklyReviewEmailSupabaseAdapter,
  deliverWeeklyReviewEmails,
  getWeeklyReviewEmailTargetWeekForTimeZone,
  shouldSendWeeklyReviewEmailNow,
  type WeeklyReviewEmailJobResult,
} from "@/lib/services/weekly-review-email-service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

function missingEnvResponse(missing: string[]) {
  return NextResponse.json(
    { ok: false, error: `Missing required environment variable(s): ${missing.join(", ")}` },
    { status: 500 },
  );
}

function getWeeklyReviewTimeZone() {
  return process.env.WEEKLY_REVIEW_TIMEZONE ?? "America/New_York";
}

function getWeeklyReviewStartHour() {
  const parsed = Number(process.env.WEEKLY_REVIEW_SEND_START_HOUR ?? "18");
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : 18;
}

function skippedScheduleResult(ownerUserIds: string[], timezone: string): WeeklyReviewEmailJobResult {
  const targetWeek = getWeeklyReviewEmailTargetWeekForTimeZone(new Date(), timezone);

  return {
    ok: true,
    ...targetWeek,
    counts: {
      generated: 0,
      sent: 0,
      skipped: ownerUserIds.length,
      failed: 0,
    },
    logs: ownerUserIds.map((ownerUserId) => ({
      ownerUserId,
      status: "skipped",
      reason: `outside Sunday evening send window for ${timezone}`,
    })),
  };
}

export async function sendWeeklyReviewsCron(request: Request) {
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

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";
  const timeZone = getWeeklyReviewTimeZone();
  const startHour = getWeeklyReviewStartHour();
  const ownerUserIds = [ownerUserId];

  if (!force && !shouldSendWeeklyReviewEmailNow({ timeZone, startHour })) {
    return NextResponse.json(skippedScheduleResult(ownerUserIds, timeZone));
  }

  try {
    const supabase = getSupabaseServiceClient();
    const adapter = createWeeklyReviewEmailSupabaseAdapter(supabase as never);
    const targetWeek = getWeeklyReviewEmailTargetWeekForTimeZone(new Date(), timeZone);
    const result = await deliverWeeklyReviewEmails({
      ...adapter,
      ownerUserIds,
      resend: getResendClient(envResult.config.resendApiKey),
      from: envResult.config.emailFrom,
      to: envResult.config.dailyAssistantEmail,
      appUrl: process.env.APP_URL,
      weekStart: targetWeek.weekStart,
      weekEnd: targetWeek.weekEnd,
    });

    return NextResponse.json({
      ...result,
      schedule: {
        timezone: timeZone,
        startHour,
        forced: force,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to deliver weekly review emails." },
      { status: 500 },
    );
  }
}
