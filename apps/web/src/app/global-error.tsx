"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { WorkspaceErrorFallback } from "@/components/layout/workspace-error-fallback";
import { WORKSPACE_THEME_INIT_SCRIPT } from "@/lib/theme-preference";

type GlobalErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalErrorPage({ error, reset }: GlobalErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <head>
        <script
          id="ega-workspace-theme"
          dangerouslySetInnerHTML={{ __html: WORKSPACE_THEME_INIT_SCRIPT }}
        />
      </head>
      <body className="min-h-full" suppressHydrationWarning>
        <WorkspaceErrorFallback reset={reset} scopeLabel="EGA House" />
      </body>
    </html>
  );
}
