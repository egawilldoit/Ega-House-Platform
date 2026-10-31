"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type FavoritesErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
  retry: () => void;
};

export default function FavoritesErrorPage({ error, reset, retry }: FavoritesErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <WorkspaceErrorFallback
      reset={reset}
      retry={retry}
      scopeLabel="Favourites"
    />
  );
}
