"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type ArchiveErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ArchiveErrorPage({ error, reset }: ArchiveErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Archive" />;
}
