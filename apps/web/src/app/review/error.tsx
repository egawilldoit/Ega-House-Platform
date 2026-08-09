"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type ReviewErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ReviewErrorPage({ error, reset }: ReviewErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Review Workspace" />;
}
