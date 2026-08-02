import { NextResponse } from "next/server";

import { buildProtectedResourceMetadata } from "@/lib/mcp/metadata";

export const dynamic = "force-dynamic";

const PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

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
      ...PREFLIGHT_HEADERS,
      "Cache-Control": "public, max-age=300, stale-while-revalidate=300",
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: PREFLIGHT_HEADERS,
  });
}
