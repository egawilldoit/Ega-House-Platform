import posthog from "posthog-js";

declare global {
  interface Window {
    __egaPostHogInitialized__?: boolean;
  }
}

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (typeof window !== "undefined" && token && host && !window.__egaPostHogInitialized__) {
  posthog.init(token, {
    api_host: host,
    autocapture: true,
    capture_pageview: true,
    defaults: "2026-01-30",
  });

  window.__egaPostHogInitialized__ = true;
}
