/**
 * CLI to generate a new agent integration token.
 *
 * Usage:
 *   npx tsx scripts/generate-agent-token.ts \
 *     --owner <uuid> \
 *     --name <non-empty name> \
 *     --scopes '<json>'
 *
 * The raw token is printed to stdout exactly once and cannot be retrieved again.
 * Errors are printed to stderr. Exit code 0 on success, 1 on failure.
 */

// ---- Argument parsing ----

interface ParsedArgs {
  ownerUserId: string;
  name: string;
  scopesRaw: string;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const map = new Map<string, string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value !== undefined && !value.startsWith("--")) {
        map.set(key, value);
        i++;
      } else {
        map.set(key, "");
      }
    }
  }

  return {
    ownerUserId: map.get("owner") ?? "",
    name: map.get("name") ?? "",
    scopesRaw: map.get("scopes") ?? "",
  };
}

// ---- Validation ----

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateOwner(owner: string): string | null {
  if (!owner) return "--owner is required";
  if (!UUID_RE.test(owner)) return "--owner must be a valid UUID";
  return null;
}

function validateName(name: string): string | null {
  if (!name) return "--name is required";
  if (name.length > 256) return "--name must be 256 characters or fewer";
  return null;
}

// ---- Main ----

async function main(): Promise<void> {
  // Parse and validate arguments
  const { ownerUserId, name, scopesRaw } = parseArgs();

  const ownerErr = validateOwner(ownerUserId);
  if (ownerErr) {
    console.error(`Error: ${ownerErr}`);
    console.error(
      "Usage: npx tsx scripts/generate-agent-token.ts --owner <uuid> --name <name> --scopes '<json>'",
    );
    process.exit(1);
  }

  const nameErr = validateName(name);
  if (nameErr) {
    console.error(`Error: ${nameErr}`);
    process.exit(1);
  }

  if (!scopesRaw) {
    console.error("Error: --scopes is required (no silent defaults)");
    process.exit(1);
  }

  // Parse and validate scopes
  let parsedScopes: unknown;
  try {
    parsedScopes = JSON.parse(scopesRaw);
  } catch {
    console.error("Error: --scopes must be valid JSON");
    process.exit(1);
  }

  const { parseRequestedScopes } = await import(
    "@/lib/services/agent-token-scopes"
  );

  const scopesResult = parseRequestedScopes(parsedScopes);
  if (!scopesResult.ok) {
    console.error(`Error: invalid scopes: ${scopesResult.error}`);
    process.exit(1);
  }

  // Database setup — CLI owns its own connection
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Error: DATABASE_URL is not set");
    process.exit(1);
  }

  const postgres = (await import("postgres")).default;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const schema = await import("@/db/schema");

  const sql = postgres(databaseUrl, { prepare: false });
  const db = drizzle(sql, { schema });

  try {
    const { DrizzleTokenRepository } = await import(
      "@/lib/services/agent-token-repository"
    );

    const repo = new DrizzleTokenRepository(db);

    // Generate token
    const { generateAgentToken } = await import(
      "@/lib/services/agent-token-service"
    );

    const rawToken = await generateAgentToken(
      ownerUserId,
      name,
      scopesResult.scopes,
      repo,
    );

    // Print raw token to stdout exactly once
    console.log(rawToken);
  } finally {
    // Close the CLI-owned connection pool
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error("Error:", (err as Error)?.message ?? err);
  process.exit(1);
});
