"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type ReviewDetailErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ReviewDetailErrorPage({ error, reset }: ReviewDetailErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Review detail" homeHref="/review" />;
}
