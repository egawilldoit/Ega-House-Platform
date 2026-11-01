"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type BacklogErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function BacklogErrorPage({ error, reset }: BacklogErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Backlog" />;
}
