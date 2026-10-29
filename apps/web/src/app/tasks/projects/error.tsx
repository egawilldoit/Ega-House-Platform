"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type ProjectsErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ProjectsErrorPage({ error, reset }: ProjectsErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Projects" homeHref="/tasks/projects" />;
}
