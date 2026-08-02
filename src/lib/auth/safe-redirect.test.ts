import { describe, expect, it } from "vitest";

import {
  resolveSafeAuthDestination,
  toInternalDestination,
} from "./safe-redirect";

const ORIGIN = "https://www.egawilldoit.online";

describe("resolveSafeAuthDestination", () => {
  it("accepts internal paths", () => {
    expect(resolveSafeAuthDestination("/dashboard?tab=today#focus", ORIGIN).href).toBe(
      "https://www.egawilldoit.online/dashboard?tab=today#focus",
    );
  });

  it("accepts EGA House root and workspace hosts", () => {
    expect(
      resolveSafeAuthDestination("https://tasks.egawilldoit.online/inbox", ORIGIN).href,
    ).toBe("https://tasks.egawilldoit.online/inbox");
    expect(
      resolveSafeAuthDestination("https://egawilldoit.online/dashboard", ORIGIN).href,
    ).toBe("https://egawilldoit.online/dashboard");
  });

  it("accepts localhost and loopback development URLs", () => {
    expect(resolveSafeAuthDestination("http://localhost:3000/dashboard", ORIGIN).href).toBe(
      "http://localhost:3000/dashboard",
    );
    expect(resolveSafeAuthDestination("http://127.0.0.1:3000/dashboard", ORIGIN).href).toBe(
      "http://127.0.0.1:3000/dashboard",
    );
  });

  it.each([
    "//evil.example/steal",
    "https://evil.example/steal",
    "javascript:alert(1)",
    "https://user:password@egawilldoit.online/dashboard",
    "http://egawilldoit.online/dashboard",
    "not a url",
  ])("falls back for unsafe destination %s", (destination) => {
    expect(resolveSafeAuthDestination(destination, ORIGIN).href).toBe(
      "https://www.egawilldoit.online/dashboard",
    );
  });

  it("uses the supplied fallback", () => {
    expect(resolveSafeAuthDestination(null, ORIGIN, "/today").pathname).toBe("/today");
  });
});

describe("toInternalDestination", () => {
  it("returns a path for the current origin", () => {
    const url = new URL("https://www.egawilldoit.online/dashboard?tab=now#focus");
    expect(toInternalDestination(url, ORIGIN)).toBe("/dashboard?tab=now#focus");
  });

  it("returns null for another allowed origin", () => {
    const url = new URL("https://tasks.egawilldoit.online/inbox");
    expect(toInternalDestination(url, ORIGIN)).toBeNull();
  });
});
