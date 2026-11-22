"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

import { useCanonicalUrl } from "@/lib/use-canonical-url";

/**
 * Cross-surface link for server-rendered pages.
 *
 * Workspace subdomains rewrite unprefixed paths into that workspace. Links that
 * intentionally leave the current workspace (Tasks → Goals, Review → Timer)
 * must keep using the canonical root host, exactly like sidebar links do.
 */
export function CanonicalLink({ href, ...props }: ComponentProps<typeof Link>) {
  const canonicalUrl = useCanonicalUrl();
  return (
    <Link
      href={typeof href === "string" ? canonicalUrl.resolve(href) : href}
      {...props}
    />
  );
}
