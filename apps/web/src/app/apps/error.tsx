"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type AppsErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function AppsErrorPage({ error, reset }: AppsErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Apps" homeHref="/apps" />;
}
