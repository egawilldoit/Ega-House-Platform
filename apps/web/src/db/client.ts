import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";

function getDatabaseUrl() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("Missing env.DATABASE_URL");
  }

  return url;
}

// Reusable server-side Drizzle client for direct Postgres access.
const sql = postgres(getDatabaseUrl(), {
  prepare: false,
});

export const db = drizzle(sql, { schema });
