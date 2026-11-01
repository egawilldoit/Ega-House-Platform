"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type NewProjectErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function NewProjectErrorPage({ error, reset }: NewProjectErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="New project" homeHref="/tasks/projects" />;
}
