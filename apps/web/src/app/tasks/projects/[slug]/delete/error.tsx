"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type ProjectDeleteErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ProjectDeleteErrorPage({ error, reset }: ProjectDeleteErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Delete project" homeHref="/tasks/projects" />;
}
