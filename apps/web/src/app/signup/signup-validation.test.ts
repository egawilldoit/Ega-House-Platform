import { describe, expect, it } from "vitest";

import {
  normalizeSignupEmail,
  normalizeSignupName,
  validateSignupFields,
} from "./signup-validation";

describe("signup normalization", () => {
  it("trims the name and normalizes email casing", () => {
    expect(normalizeSignupName("  Abdelilah Mortaki  ")).toBe("Abdelilah Mortaki");
    expect(normalizeSignupEmail("  USER@Example.COM ")).toBe("user@example.com");
  });
});

describe("validateSignupFields", () => {
  it("accepts a valid passphrase", () => {
    expect(
      validateSignupFields({
        fullName: "Abdelilah Mortaki",
        email: "user@example.com",
        password: "correct horse battery staple",
      }),
    ).toEqual({});
  });

  it("requires a name and limits it to 100 characters", () => {
    expect(validateSignupFields({ fullName: " ", email: "user@example.com", password: "long enough password" }).fullName).toBeTruthy();
    expect(validateSignupFields({ fullName: "a".repeat(101), email: "user@example.com", password: "long enough password" }).fullName).toBeTruthy();
  });

  it("rejects malformed emails", () => {
    expect(validateSignupFields({ fullName: "User", email: "not-an-email", password: "long enough password" }).email).toBeTruthy();
  });

  it("requires passwords between 12 and 128 characters", () => {
    expect(validateSignupFields({ fullName: "User", email: "user@example.com", password: "too short" }).password).toBeTruthy();
    expect(validateSignupFields({ fullName: "User", email: "user@example.com", password: "a".repeat(129) }).password).toBeTruthy();
  });
});
