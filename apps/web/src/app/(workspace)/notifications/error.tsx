"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type NotificationsErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function NotificationsErrorPage({ error, reset }: NotificationsErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Notifications" homeHref="/notifications" />;
}
