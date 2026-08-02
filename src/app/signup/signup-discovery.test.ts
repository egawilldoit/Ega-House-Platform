import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const loginPage = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");
const loginForm = readFileSync(resolve(process.cwd(), "src/app/login/login-form.tsx"), "utf8");
const homePage = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");

const canonicalSignupUrl = "https://www.egawilldoit.online/signup";

describe("public signup discovery", () => {
  it("uses the canonical signup destination from both login entry points", () => {
    expect(loginPage).toContain(canonicalSignupUrl);
    expect(loginPage).toContain("encodeURIComponent(nextParam)");
    expect(loginPage).toContain("<LoginForm signupHref={signupHref} />");
    expect(loginForm).toContain("signupHref: string");
    expect(loginForm).toContain("Create your account");
  });

  it("offers signup in the homepage hero and after the workflow explanation", () => {
    expect(homePage.match(/https:\/\/www\.egawilldoit\.online\/signup/g)).toHaveLength(2);
    expect(homePage).toContain("Create account");
    expect(homePage).toContain("Ready to start?");
    expect(homePage).toContain("Turn the workflow into your workspace.");
    expect(homePage).toContain("Create your account");
  });

  it("keeps existing-user navigation available", () => {
    expect(homePage).toContain("Enter workspace");
    expect(homePage).toContain("Sign in instead");
    expect(loginForm).toContain("Sign in to your workspace");
  });
});
