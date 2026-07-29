import { NextResponse } from "next/server";

import { buildProtectedResourceMetadata } from "@/lib/mcp/metadata";

export const dynamic = "force-dynamic";

function requireEnv(
  name:
    | "MCP_RESOURCE_URL"
    | "NEXT_PUBLIC_SUPABASE_URL",
): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing env.${name}`);
  }

  return value;
}

export async function GET() {
  const resourceDocumentation =
    process.env.MCP_RESOURCE_DOCUMENTATION_URL || undefined;

  const metadata = buildProtectedResourceMetadata({
    resource: requireEnv("MCP_RESOURCE_URL"),
    authorizationServer: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    resourceDocumentation,
  });

  return NextResponse.json(metadata, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=300",
    },
  });
}
