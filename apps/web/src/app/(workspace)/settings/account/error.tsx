"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type AccountSettingsErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function AccountSettingsErrorPage({ error, reset }: AccountSettingsErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Account settings" homeHref="/settings/account" />;
}
