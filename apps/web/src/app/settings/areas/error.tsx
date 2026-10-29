"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type AreasErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function AreasErrorPage({ error, reset }: AreasErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <WorkspaceErrorFallback
      reset={reset}
      scopeLabel="Areas"
      homeHref="/settings/areas"
    />
  );
}
