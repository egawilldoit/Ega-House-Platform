"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type WorkAnalyticsErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function WorkAnalyticsErrorPage({ error, reset }: WorkAnalyticsErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Work analytics" homeHref="/work-analytics" />;
}
