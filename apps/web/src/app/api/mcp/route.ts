import { createLazyMcpEndpoint } from "@/lib/mcp/endpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const endpoint = createLazyMcpEndpoint();

/**
 * `runtime`, `dynamic` and `maxDuration` above are this route's segment config,
 * read by Next.js through `parseAppSegmentConfig` (verified against the
 * installed 16.3.8 `next/dist/build/segment-config/app/app-segment-config`).
 *
 * `maxDuration` is the ONLY request-duration budget on this route. The transport
 * used to also accept a `maxDuration` transport option that nothing read, which
 * made it look like the budget was enforced in two places; it was enforced here
 * alone, and is now the only place a reader has to look.
 */
export async function GET(request: Request): Promise<Response> {
  return endpoint.GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return endpoint.POST(request);
}

export async function OPTIONS(request: Request): Promise<Response> {
  return endpoint.OPTIONS(request);
}
