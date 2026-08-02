import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./signup-form.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./signup.module.css", import.meta.url), "utf8");

describe("public signup UI contract", () => {
  it("contains the required signup fields and accessible autocomplete values", () => {
    expect(source).toContain("Build your control room");
    expect(source).toContain('autoComplete="name"');
    expect(source).toContain('autoComplete="email"');
    expect(source).toContain('autoComplete="new-password"');
    expect(source).toContain("Show password");
    expect(source).toContain("Hide password");
    expect(source).not.toMatch(/confirm[- ]password/i);
  });

  it("uses Supabase signup metadata, callback URL, and optional CAPTCHA", () => {
    expect(source).toContain("supabase.auth.signUp");
    expect(source).toContain("full_name: normalizedName");
    expect(source).toContain("emailRedirectTo: confirmationUrl.href");
    expect(source).toContain("captchaToken");
  });

  it("has an honest confirmation-required state", () => {
    expect(source).toContain("Check your inbox");
    expect(source).toContain("Your workspace stays locked until you confirm the email");
    expect(source).toContain("Use a different email");
  });

  it("includes responsive and reduced-motion styling", () => {
    expect(styles).toContain("@media (max-width: 960px)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
