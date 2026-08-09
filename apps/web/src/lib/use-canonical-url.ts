"use client";

import { useMemo } from "react";

/**
 * Workspace subdomain → route prefix mapping.
 * Duplicated from src/middleware.ts constants for client-side use.
 */
const WORKSPACE_PREFIXES: Record<string, `/${string}`> = {
  "goals.egawilldoit.online": "/goals",
  "tasks.egawilldoit.online": "/tasks",
  "timer.egawilldoit.online": "/timer",
  "review.egawilldoit.online": "/review",
};

const ROOT_HOSTNAMES = new Set([
  "egawilldoit.online",
  "www.egawilldoit.online",
  "localhost",
]);

/**
 * Global app routes that live on the root host, not inside any workspace.
 * These must never be rewritten with a workspace prefix.
 */
export const GLOBAL_APP_ROUTES = new Set([
  "/dashboard",
  "/today",
  "/ideas",
  "/help",
  "/settings",
  "/startup",
  "/shutdown",
  "/apps",
]);

const CANONICAL_ORIGIN = "https://www.egawilldoit.online";

function getHostname(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.location.hostname.toLowerCase();
}

function getWorkspacePrefix(hostname: string): `/${string}` | null {
  return WORKSPACE_PREFIXES[hostname] ?? null;
}

/**
 * Returns whether the given route belongs to the current workspace subdomain.
 * E.g., on tasks.egawilldoit.online, "/tasks" and "/tasks/*" belong;
 * "/dashboard" and "/goals" do not.
 */
export function routeBelongsToWorkspace(
  route: `/${string}`,
  hostname: string,
): boolean {
  const prefix = getWorkspacePrefix(hostname);
  if (!prefix) {
    // Not on a workspace subdomain — all routes belong to the root host.
    return true;
  }
  return route === prefix || route.startsWith(`${prefix}/`);
}

/**
 * Hook that returns a URL resolver for the current host.
 *
 * - On the root host or localhost: returns the relative path as-is.
 * - On a workspace subdomain:
 *   - If the target route belongs to the current workspace → relative path (no change).
 *   - If the target route is a global app route → absolute canonical URL.
 *   - If the target route belongs to a different workspace → absolute canonical URL.
 */
export function useCanonicalUrl() {
  return useMemo(() => {
    const hostname = getHostname();

    return {
      /**
       * Returns the best href for a navigation link given the current host context.
       */
      resolve(route: `/${string}`): string {
        if (!hostname || ROOT_HOSTNAMES.has(hostname)) {
          return route;
        }

        const prefix = getWorkspacePrefix(hostname);
        if (!prefix) {
          // Unknown host — preserve relative navigation.
          return route;
        }

        // If the target belongs to the current workspace, keep it relative.
        if (routeBelongsToWorkspace(route, hostname)) {
          return route;
        }

        // Otherwise, route to the canonical root host.
        return `${CANONICAL_ORIGIN}${route}`;
      },
    };
  }, []);
}
