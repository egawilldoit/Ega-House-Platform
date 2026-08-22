import path from "node:path";

import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

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
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
});
