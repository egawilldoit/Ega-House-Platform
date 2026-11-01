"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type StartupErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function StartupErrorPage({ error, reset }: StartupErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Startup Workspace" />;
}
