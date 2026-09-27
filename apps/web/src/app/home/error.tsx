"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";

/**
 * Authenticated Home error boundary.
 *
 * Renders only after the server-composed Home model failed; it never fabricates
 * focus, Today, attention, or activity content. The retry re-runs the route's
 * server component so the canonical owners get another chance.
 */
export default function HomeErrorPage() {
  return (
    <div
      className="flex min-h-[60vh] flex-col items-start justify-center gap-4"
      data-testid="home-error"
      role="alert"
    >
      <h1 className="text-[length:var(--text-panel-title)] font-semibold tracking-[var(--tracking-tight)]">
        Home couldn&rsquo;t load.
      </h1>
      <p className="max-w-[52ch] text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-[color:var(--ega-text-secondary)]">
        Your focus, Today, attention, and activity signals could not be composed right now. Your
        tasks and timer are unaffected.
      </p>
      <button
        type="button"
        className="btn-instrument flex h-9 items-center gap-2 px-3 text-sm"
        onClick={() => window.location.reload()}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Try again
      </button>
      <Link
        href="/today"
        className="text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)] underline-offset-4 hover:text-[color:var(--ega-text)] hover:underline"
      >
        Open Today instead
      </Link>
    </div>
  );
}
