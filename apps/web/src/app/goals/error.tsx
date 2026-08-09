"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type GoalsErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GoalsErrorPage({ error, reset }: GoalsErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Goals Workspace" />;
}
