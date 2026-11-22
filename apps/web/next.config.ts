import path from "node:path";

import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  transpilePackages: ["@ega/application", "@ega/contracts", "@ega/data-access", "@ega/domain"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  turbopack: {
    // node_modules is hoisted to the npm workspace root; Next must resolve
    // from there, not from apps/web.
    root: path.resolve(__dirname, "..", ".."),
  },
  async redirects() {
    return [
      { source: "/dashboard", destination: "/today", permanent: false },
      { source: "/ideas", destination: "/backlog", permanent: false },
      { source: "/backlog", destination: "/tasks?tab=inbox", permanent: false },
      { source: "/apps", destination: "/today", permanent: false },
      { source: "/apps/:workspace", destination: "/today", permanent: false },
      { source: "/home", destination: "/today", permanent: false },
      { source: "/shutdown", destination: "/today", permanent: false },
      { source: "/favorites", destination: "/today", permanent: false },
      { source: "/archive", destination: "/tasks?tab=archived", permanent: false },
      { source: "/work-analytics", destination: "/review", permanent: false },
      { source: "/work-analytics/:path*", destination: "/review", permanent: false },
      { source: "/friction", destination: "/review", permanent: false },
      { source: "/startup", destination: "/today", permanent: false },
      { source: "/notifications", destination: "/today", permanent: false },
      { source: "/help", destination: "/today", permanent: false },
      { source: "/agents", destination: "/settings?tab=integrations", permanent: false },
      { source: "/agents/:path*", destination: "/settings?tab=integrations", permanent: false },
      { source: "/settings/account", destination: "/settings", permanent: false },
      { source: "/settings/appearance", destination: "/settings?tab=preferences", permanent: false },
      { source: "/settings/preferences", destination: "/settings?tab=preferences", permanent: false },
      { source: "/settings/areas", destination: "/tasks/projects/areas", permanent: false },
      { source: "/money/bills", destination: "/money/recurring?type=bill", permanent: false },
      { source: "/money/subscriptions", destination: "/money/recurring?type=subscription", permanent: false },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
});
