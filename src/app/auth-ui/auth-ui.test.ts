import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const pathFor = (path: string) => resolve(root, path);
const read = (path: string) => readFileSync(pathFor(path), "utf8");

const sharedFiles = [
  "src/app/auth-ui/auth-shell.tsx",
  "src/app/auth-ui/auth-header.tsx",
  "src/app/auth-ui/auth-study-label.tsx",
  "src/app/auth-ui/auth-geometry.tsx",
  "src/app/auth-ui/auth-motion.tsx",
  "src/app/auth-ui/auth-field.tsx",
  "src/app/auth-ui/auth-submit.tsx",
  "src/app/auth-ui/auth-feedback.tsx",
  "src/app/auth-ui/auth.css",
] as const;

describe("shared auth editorial system", () => {
  it("provides the complete shared auth presentation boundary", () => {
    for (const file of sharedFiles) {
      expect(existsSync(pathFor(file)), `${file} should exist`).toBe(true);
    }
  });

  it("defines both approved auth themes and reduced-motion behavior", () => {
    const css = read("src/app/auth-ui/auth.css");

    expect(css).toContain('[data-auth-theme="black-signal"]');
    expect(css).toContain('[data-auth-theme="signal-cream"]');
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

  it("keeps login and signup on complementary editorial themes", () => {
    const login = read("src/app/login/login-form.tsx");
    const signup = read("src/app/signup/signup-form.tsx");

    expect(login).toContain('theme="black-signal"');
    expect(login).toContain("Return to");
    expect(login).toContain("the system.");
    expect(login).toContain("AUTH 01");
    expect(signup).toContain('theme="signal-cream"');
    expect(signup).toContain("Build your");
    expect(signup).toContain("control room.");
    expect(signup).toContain("AUTH 02");
  });

  it("keeps the desktop login story and form inside the safe viewport", () => {
    const css = read("src/app/auth-ui/auth.css");

    expect(css).toContain('[data-auth-theme="black-signal"] .auth-layout');
    expect(css).toContain("align-items: start");
    expect(css).toContain('[data-auth-theme="black-signal"] .auth-display');
    expect(css).toContain('[data-auth-theme="black-signal"] .auth-operation-list');
    expect(css).toContain('@media (min-width: 861px) and (max-height: 1080px)');
  });
});