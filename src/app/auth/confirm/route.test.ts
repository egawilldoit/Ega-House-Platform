import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

describe("signup confirmation route contract", () => {
  it("supports token-hash and standard PKCE confirmation callbacks", () => {
    expect(source).toContain("verifyOtp");
    expect(source).toContain("exchangeCodeForSession");
    expect(source).toContain('searchParams.get("code")');
  });

  it("uses the shared safe destination and strips secrets on failure", () => {
    expect(source).toContain("resolveSafeAuthDestination");
    expect(source).toContain('url.searchParams.set("error", "confirmation_failed")');
    expect(source).not.toContain("token_hash=${");
  });
});
