import {
  authorizeCronRequest,
  missingCronEnvResponse,
} from "@/lib/cron/route-runtime";
import { getEmailEnvConfig, getResendClient } from "@/lib/email/resend";

export async function POST(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;

  const envResult = getEmailEnvConfig();
  if (!envResult.ok) {
    return missingCronEnvResponse(envResult.missing);
  }

  const resend = getResendClient(envResult.config.resendApiKey);
  const { data, error } = await resend.emails.send({
    from: envResult.config.emailFrom,
    to: envResult.config.dailyAssistantEmail,
    subject: "EGA House email test",
    html: "<p>The Resend + Vercel email setup works for EGA House.</p>",
  });

  if (error) {
    return Response.json({ ok: false, error }, { status: 500 });
  }

  return Response.json({ ok: true, id: data?.id });
}
