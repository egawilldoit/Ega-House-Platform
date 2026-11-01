"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type FrictionErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function FrictionErrorPage({ error, reset }: FrictionErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Friction Radar" homeHref="/friction" />;
}
