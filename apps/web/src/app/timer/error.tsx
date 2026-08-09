"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type TimerErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function TimerErrorPage({ error, reset }: TimerErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Timer Workspace" />;
}
