import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",
  environment:
    process.env.SENTRY_ENVIRONMENT ??
    process.env.APP_ENV ??
    process.env.NODE_ENV,
});
