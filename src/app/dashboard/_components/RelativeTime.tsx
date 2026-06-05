"use client";

import { useEffect, useState } from "react";

interface RelativeTimeProps {
  isoString: string;
  className?: string;
}

function formatRelative(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diffMs / 1000);

  if (seconds < 60) {
    return `${Math.max(0, seconds)}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return new Date(isoString).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function RelativeTime({ isoString, className }: RelativeTimeProps) {
  const [label, setLabel] = useState<string>(() => formatRelative(isoString));

  useEffect(() => {
    const update = () => setLabel(formatRelative(isoString));
    update();
    const id = window.setInterval(update, 30_000);
    return () => window.clearInterval(id);
  }, [isoString]);

  return (
    <time dateTime={isoString} className={className} suppressHydrationWarning>
      {label}
    </time>
  );
}
