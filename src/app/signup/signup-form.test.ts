import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/app/signup/signup-form.tsx"),
  "utf8",
);
const normalizedSource = source.replace(/\s+/g, " ");
const styles = readFileSync(
  resolve(process.cwd(), "src/app/signup/signup.module.css"),
  "utf8",
);

describe("public signup UI contract", () => {
  it("contains the required signup fields and accessible autocomplete values", () => {
    expect(source).toContain("Build your");
    expect(source).toContain("control room.");
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
    expect(normalizedSource).toContain(
      "Your workspace stays locked until you confirm the email",
    );
    expect(source).toContain("Use a different email");
  });

  it("includes responsive and reduced-motion styling", () => {
    expect(styles).toContain("@media (max-width: 960px)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
