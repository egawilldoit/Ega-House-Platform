import {
  authorizeCronRequest,
  missingCronEnvResponse,
  runCronOperation,
} from "@/lib/cron/route-runtime";
import { getEmailEnvConfig, getResendClient } from "@/lib/email/resend";
import { deliverTaskReminderEmails } from "@/lib/services/task-reminder-delivery-service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function POST(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;

  const envResult = getEmailEnvConfig();
  if (!envResult.ok) {
    return missingCronEnvResponse(envResult.missing);
  }

  const ownerUserId = process.env.EGA_OWNER_USER_ID;
  if (!ownerUserId) {
    return missingCronEnvResponse(["EGA_OWNER_USER_ID"]);
  }

  return runCronOperation(
    () =>
      deliverTaskReminderEmails({
        supabase: getSupabaseServiceClient() as never,
        resend: getResendClient(envResult.config.resendApiKey),
        from: envResult.config.emailFrom,
        to: envResult.config.dailyAssistantEmail,
        ownerUserId,
      }),
    "Failed to deliver task reminder emails.",
  );
}
