"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type ProjectDetailErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ProjectDetailErrorPage({ error, reset }: ProjectDetailErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Project workspace" homeHref="/tasks/projects" />;
}
