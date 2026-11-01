"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type IdeasErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function IdeasErrorPage({ error, reset }: IdeasErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Ideas" />;
}
