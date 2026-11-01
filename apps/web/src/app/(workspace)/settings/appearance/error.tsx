"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type AppearanceSettingsErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function AppearanceSettingsErrorPage({
  error,
  reset,
}: AppearanceSettingsErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <WorkspaceErrorFallback
      reset={reset}
      scopeLabel="Appearance settings"
      homeHref="/settings/appearance"
    />
  );
}
