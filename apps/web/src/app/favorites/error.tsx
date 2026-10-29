"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";

type FavoritesErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function FavoritesErrorPage({ error, reset }: FavoritesErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <WorkspaceErrorFallback reset={reset} scopeLabel="Favourites" />;
}
