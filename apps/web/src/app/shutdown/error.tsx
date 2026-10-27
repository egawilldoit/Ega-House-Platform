"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type ShutdownErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ShutdownErrorPage({ error, reset }: ShutdownErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Shutdown" homeHref="/shutdown" />;
}
