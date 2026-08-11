import { NextResponse } from "next/server";

import { getEmailEnvConfig, getResendClient } from "@/lib/email/resend";
import { deliverTaskReminderEmails } from "@/lib/services/task-reminder-delivery-service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

import {
  authorizeCronRequest,
  missingCronEnvResponse,
} from "../_lib/runtime";

export async function POST(request: Request) {
  const authorizationFailure = authorizeCronRequest(request);
  if (authorizationFailure) {
    return authorizationFailure;
  }

  const envResult = getEmailEnvConfig();
  if (!envResult.ok) {
    return missingCronEnvResponse(envResult.missing);
  }

  const ownerUserId = process.env.EGA_OWNER_USER_ID;
  if (!ownerUserId) {
    return missingCronEnvResponse(["EGA_OWNER_USER_ID"]);
  }

  try {
    const result = await deliverTaskReminderEmails({
      supabase: getSupabaseServiceClient() as never,
      resend: getResendClient(envResult.config.resendApiKey),
      from: envResult.config.emailFrom,
      to: envResult.config.dailyAssistantEmail,
      ownerUserId,
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to deliver task reminder emails." },
      { status: 500 },
    );
  }
}
