import { GET as getProtectedResourceMetadata } from "../../route";

export const dynamic = "force-dynamic";

export async function GET() {
  return await getProtectedResourceMetadata();
}
