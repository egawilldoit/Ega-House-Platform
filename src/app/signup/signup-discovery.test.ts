import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const loginPage = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");
const loginForm = readFileSync(resolve(process.cwd(), "src/app/login/login-form.tsx"), "utf8");
const homeSources = [
  "src/app/home/home-data.ts",
  "src/app/home/sections/hero-study.tsx",
  "src/app/home/sections/conversion-study.tsx",
]
  .map((path) => readFileSync(resolve(process.cwd(), path), "utf8"))
  .join("\n");

const canonicalSignupUrl = "https://www.egawilldoit.online/signup";

describe("public signup discovery", () => {
  it("uses the canonical signup destination from both login entry points", () => {
    expect(loginPage).toContain(canonicalSignupUrl);
    expect(loginPage).toContain("encodeURIComponent(nextParam)");
    expect(loginPage).toContain("<LoginForm signupHref={signupHref} />");
    expect(loginForm).toContain("signupHref: string");
    expect(loginForm).toContain("Create your account");
  });

  it("offers signup in the homepage hero and final workspace study", () => {
    expect(homeSources).toContain(`SIGNUP_HREF = "${canonicalSignupUrl}"`);
    expect(homeSources).toContain("Create account");
    expect(homeSources).toContain("Build the week.");
    expect(homeSources).toContain("Create your account");
  });

  it("keeps existing-user navigation available", () => {
    expect(homeSources).toContain('LOGIN_HREF = "/login?next=%2Fdashboard"');
    expect(homeSources).toContain("Enter workspace");
    expect(loginForm).toContain("Sign in to continue");
  });
});
