import { Resend } from "resend";

export const REQUIRED_EMAIL_ENV_VARS = [
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "DAILY_ASSISTANT_EMAIL",
  "CRON_SECRET",
] as const;

export const REQUIRED_RESEND_EMAIL_ENV_VARS = [
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "DAILY_ASSISTANT_EMAIL",
] as const;

type RequiredEmailEnvVar = (typeof REQUIRED_EMAIL_ENV_VARS)[number];
type RequiredResendEmailEnvVar = (typeof REQUIRED_RESEND_EMAIL_ENV_VARS)[number];

export type EmailEnvConfig = {
  resendApiKey: string;
  emailFrom: string;
  dailyAssistantEmail: string;
  cronSecret: string;
};

export type ResendEmailEnvConfig = Omit<EmailEnvConfig, "cronSecret">;

let resendClient: Resend | null = null;

export function getMissingEmailEnvVars() {
  return REQUIRED_EMAIL_ENV_VARS.filter((name) => !process.env[name]);
}

export function getMissingResendEmailEnvVars() {
  return REQUIRED_RESEND_EMAIL_ENV_VARS.filter((name) => !process.env[name]);
}

export function getEmailEnvConfig():
  | { ok: true; config: EmailEnvConfig }
  | { ok: false; missing: RequiredEmailEnvVar[] } {
  const missing = getMissingEmailEnvVars();

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    config: {
      resendApiKey: process.env.RESEND_API_KEY!,
      emailFrom: process.env.EMAIL_FROM!,
      dailyAssistantEmail: process.env.DAILY_ASSISTANT_EMAIL!,
      cronSecret: process.env.CRON_SECRET!,
    },
  };
}

export function getResendEmailEnvConfig():
  | { ok: true; config: ResendEmailEnvConfig }
  | { ok: false; missing: RequiredResendEmailEnvVar[] } {
  const missing = getMissingResendEmailEnvVars();

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    config: {
      resendApiKey: process.env.RESEND_API_KEY!,
      emailFrom: process.env.EMAIL_FROM!,
      dailyAssistantEmail: process.env.DAILY_ASSISTANT_EMAIL!,
    },
  };
}

export function getResendClient(apiKey: string) {
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }

  return resendClient;
}
