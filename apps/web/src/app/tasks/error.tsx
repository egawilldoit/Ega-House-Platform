"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type TasksErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function TasksErrorPage({ error, reset }: TasksErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Tasks Workspace" />;
}
