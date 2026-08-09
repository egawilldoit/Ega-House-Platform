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

const signupPath = "/signup";

describe("public signup discovery", () => {
  it("keeps both login signup links on the current deployment origin", () => {
    expect(loginPage).toContain(`const PUBLIC_SIGNUP_PATH = "${signupPath}"`);
    expect(loginPage).toContain("encodeURIComponent(nextParam)");
    expect(loginPage).toContain("<LoginForm signupHref={signupHref} />");
    expect(loginPage).not.toContain("www.egawilldoit.online/signup");
    expect(loginForm).toContain("signupHref: string");
    expect(loginForm).toContain("Create your account");
  });

  it("offers same-origin signup in the homepage hero and final workspace study", () => {
    expect(homeSources).toContain(`SIGNUP_HREF = "${signupPath}"`);
    expect(homeSources).not.toContain("www.egawilldoit.online/signup");
    expect(homeSources.match(/Create account/g)).toHaveLength(2);
    expect(homeSources).not.toContain("Create your account");
    expect(homeSources).toContain("Build the week.");
  });

  it("keeps existing-user navigation available", () => {
    expect(homeSources).toContain('LOGIN_HREF = "/login?next=%2Fdashboard"');
    expect(homeSources).toContain("Enter workspace");
    expect(loginForm).toContain("Sign in to continue");
  });
});
