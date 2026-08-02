import { createLazyMcpEndpoint } from "@/lib/mcp/endpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const endpoint = createLazyMcpEndpoint();

export async function GET(request: Request): Promise<Response> {
  return endpoint.GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return endpoint.POST(request);
}

export async function OPTIONS(): Promise<Response> {
  return endpoint.OPTIONS();
}
