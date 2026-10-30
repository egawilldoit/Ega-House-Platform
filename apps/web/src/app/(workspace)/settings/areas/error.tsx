"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type AreasErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
  retry: () => void;
};

export default function AreasErrorPage({ error, reset, retry }: AreasErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <WorkspaceErrorFallback
      reset={reset}
      retry={retry}
      scopeLabel="Areas"
    />
  );
}
