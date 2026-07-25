import postgres from "postgres";
import type { Config } from "./config.js";

let sql: postgres.Sql<{}> | null = null;

export function getDb(config: Pick<Config, "databaseUrl">): postgres.Sql<{}> {
  if (sql) return sql;

  sql = postgres(config.databaseUrl, {
    prepare: false,
    connection: {
      application_name: "ega-runner",
    },
    // Allow the daemon to survive brief network interruptions
    max: 3,
    idle_timeout: 30,
    connect_timeout: 10,
    max_lifetime: 60 * 60,
  });

  return sql;
}

export async function closeDb(): Promise<void> {
  if (sql) {
    await sql.end({ timeout: 5 });
    sql = null;
  }
}

/** Quick connectivity check */
export async function checkDbHealth(
  db: postgres.Sql<{}>,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const result = await db`SELECT 1 AS ok`;
    return { ok: result[0]?.ok === 1 };
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
}
