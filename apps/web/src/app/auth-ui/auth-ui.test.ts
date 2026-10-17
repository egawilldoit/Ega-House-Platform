import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const pathFor = (path: string) => resolve(root, path);
const read = (path: string) => readFileSync(pathFor(path), "utf8");

const sharedFiles = [
  "src/app/auth-ui/auth-shell.tsx",
  "src/app/auth-ui/auth-header.tsx",
  "src/app/auth-ui/auth-motion.tsx",
  "src/app/auth-ui/auth-field.tsx",
  "src/app/auth-ui/auth-submit.tsx",
  "src/app/auth-ui/auth-feedback.tsx",
  "src/app/auth-ui/auth.css",
  "src/app/auth-ui/auth-login-viewport.css",
] as const;

describe("shared auth presentation system", () => {
  it("provides the complete shared auth presentation boundary", () => {
    for (const file of sharedFiles) {
      expect(existsSync(pathFor(file)), `${file} should exist`).toBe(true);
    }
  });

  it("defines the public-home auth theme and reduced-motion behavior", () => {
    const css = read("src/app/auth-ui/auth.css");

    expect(css).toContain('[data-auth-theme="house-cream"]');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("--auth-signal: #ff4b2b");
    expect(css).toContain("--auth-citrus: #ffd400");
  });

  it("uses Motion with the user reduced-motion preference", () => {
    const motion = read("src/app/auth-ui/auth-motion.tsx");

    expect(motion).toContain('from "motion/react"');
    expect(motion).toContain("MotionConfig");
    expect(motion).toContain('reducedMotion="user"');
  });

  it("keeps login and signup on the public home treatment", () => {
    const login = read("src/app/login/login-form.tsx");
    const signup = read("src/app/signup/signup-form.tsx");

    expect(login).toContain('theme="house-cream"');
    expect(login).toContain('aria-label="Return to the system."');
    expect(login).toContain("--auth-w");
    expect(login).not.toContain("AUTH 01");
    expect(signup).toContain('theme="house-cream"');
    expect(signup).toContain('aria-label="Build your control room."');
    expect(signup).toContain("--auth-w");
    expect(signup).not.toContain("AUTH 02");
  });

  it("keeps the desktop login story and form inside the safe viewport", () => {
    const css = read("src/app/auth-ui/auth-login-viewport.css");

    expect(css).toContain('[data-auth-theme="house-cream"] .auth-layout');
    expect(css).toContain("align-items: start");
    expect(css).toContain('[data-auth-theme="house-cream"] .auth-display');
    expect(css).toContain('[data-auth-theme="house-cream"] .auth-operation-list');
    expect(css).toContain('@media (min-width: 861px) and (max-height: 900px)');
  });
});