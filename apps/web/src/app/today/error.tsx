"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type TodayErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function TodayErrorPage({ error, reset }: TodayErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Today" homeHref="/today" />;
}
