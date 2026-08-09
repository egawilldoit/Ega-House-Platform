import { NextResponse } from "next/server";

import { getDashboardHealthData } from "@/app/dashboard/_lib/dashboard-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getDashboardHealthData();

  return NextResponse.json(health, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
