import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";

declare global {
  interface Window {
    __egaPostHogInitialized__?: boolean;
    __egaSentryInitialized__?: boolean;
  }
}

const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (
  typeof window !== "undefined" &&
  sentryDsn &&
  !window.__egaSentryInitialized__
) {
  Sentry.init({
    dsn: sentryDsn,
    enabled: process.env.NODE_ENV === "production",
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  });

  window.__egaSentryInitialized__ = true;
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

if (typeof window !== "undefined" && token && host && !window.__egaPostHogInitialized__) {
  posthog.init(token, {
    api_host: host,
    autocapture: true,
    capture_pageview: true,
    defaults: "2026-01-30",
  });

  window.__egaPostHogInitialized__ = true;
}
