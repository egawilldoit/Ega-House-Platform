import { NextResponse } from "next/server";
import { Resend } from "resend";

const EMAIL_ENV_VARS = ["RESEND_API_KEY", "EMAIL_FROM", "DAILY_ASSISTANT_EMAIL"] as const;

function missingEnvResponse(name: string) {
  return NextResponse.json(
    { ok: false, error: `Missing required environment variable: ${name}` },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return missingEnvResponse("CRON_SECRET");
  }

  const authorization = request.headers.get("authorization");

  if (authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const missingEnvVar = EMAIL_ENV_VARS.find((name) => !process.env[name]);
  if (missingEnvVar) {
    return missingEnvResponse(missingEnvVar);
  }

  const resend = new Resend(process.env.RESEND_API_KEY!);
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: process.env.DAILY_ASSISTANT_EMAIL!,
    subject: "EGA House email test",
    html: "<p>The Resend + Vercel email setup works for EGA House.</p>",
  });

  if (error) {
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data?.id });
}
