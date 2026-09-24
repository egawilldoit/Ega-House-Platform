import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * These assertions pin the convergence this change relies on: the hot read
 * paths must resolve identity through the single request-scoped resolver rather
 * than their own `auth.getUser()` round trips. React's `cache()` is only
 * memoized inside a Next server request, so the dedupe itself is exercised at
 * runtime; here we guarantee the call sites cannot drift back out.
 */
describe("request-scoped identity convergence", () => {
  it("wraps the default request identity in a request-scoped cache", () => {
    const auth = read("src/lib/services/auth-service.ts");

    expect(auth).toMatch(/const getRequestUser = cache\(/);
    expect(auth).toMatch(/return getRequestUser\(\)/);
  });

  it("keeps the shell identity on the canonical resolver", () => {
    const shell = read("src/lib/workspace-shell.ts");

    expect(shell).toContain(
      'import { getCurrentUser } from "@/lib/services/auth-service"',
    );
    expect(shell).toMatch(/return await getCurrentUser\(\)/);
    expect(shell).not.toMatch(/\.auth\.getUser\(\)/);
  });

  it("removes direct auth.getUser round trips from the Today read services", () => {
    for (const file of [
      "src/lib/services/health-snapshot-service.ts",
      "src/lib/services/operator-service.ts",
      "src/lib/services/friction-service.ts",
    ]) {
      expect(read(file), file).not.toMatch(/\.auth\.getUser\(\)/);
    }
  });
});
