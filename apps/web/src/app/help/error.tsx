"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type HelpErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function HelpErrorPage({ error, reset }: HelpErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Help" homeHref="/help" />;
}
