import { describe, expect, it } from "vitest";

import {
  buildConsentLoginPath,
  normalizeAuthorizationDetails,
  parseConsentDecision,
  parseRequestedScopes,
  requireSameOrigin,
} from "@/lib/oauth/consent";

describe("OAuth consent helpers", () => {
  it("preserves the authorization request through login", () => {
    expect(buildConsentLoginPath("authorization-123")).toBe(
      "/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dauthorization-123",
    );
  });

  it("normalizes authorization details without trusting one client-id shape", () => {
    expect(
      normalizeAuthorizationDetails({
        authorization_id: "authorization-123",
        client: {
          client_id: "client-123",
          name: "Hermes",
        },
        redirect_uri: "http://127.0.0.1:3210/callback",
        scope: "openid email profile email",
      }),
    ).toEqual({
      authorizationId: "authorization-123",
      clientId: "client-123",
      clientName: "Hermes",
      redirectUri: "http://127.0.0.1:3210/callback",
      scopes: ["openid", "email", "profile"],
    });
  });

  it("accepts the alternate nested client id returned by Supabase versions", () => {
    expect(
      normalizeAuthorizationDetails({
        authorization_id: "authorization-123",
        client: {
          id: "client-456",
          name: "Codex",
        },
        scope: "openid",
      }).clientId,
    ).toBe("client-456");
  });

  it("rejects malformed authorization details", () => {
    expect(() =>
      normalizeAuthorizationDetails({
        authorization_id: "authorization-123",
        client: { name: "Missing client id" },
      }),
    ).toThrow("Invalid OAuth authorization details.");
  });

  it("deduplicates and bounds requested scopes", () => {
    expect(parseRequestedScopes("openid  email openid profile")).toEqual([
      "openid",
      "email",
      "profile",
    ]);
    expect(() => parseRequestedScopes("x".repeat(4097))).toThrow(
      "Invalid OAuth authorization details.",
    );
  });

  it("accepts only explicit approve or deny decisions", () => {
    expect(parseConsentDecision("approve")).toBe("approve");
    expect(parseConsentDecision("deny")).toBe("deny");
    expect(() => parseConsentDecision("yes")).toThrow(
      "Invalid OAuth consent decision.",
    );
  });

  it("requires consent form posts to originate from the same site", () => {
    expect(() =>
      requireSameOrigin(
        new Request("https://preview.example/oauth/decision", {
          method: "POST",
          headers: { origin: "https://preview.example" },
        }),
      ),
    ).not.toThrow();

    expect(() =>
      requireSameOrigin(
        new Request("https://preview.example/oauth/decision", {
          method: "POST",
          headers: { origin: "https://attacker.example" },
        }),
      ),
    ).toThrow("Invalid OAuth consent origin.");
  });
});
