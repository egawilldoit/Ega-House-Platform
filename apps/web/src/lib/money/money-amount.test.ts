import { describe, expect, it } from "vitest";

import {
  formatMinorToMad,
  formatMinorToMadInput,
  parseMadAmountToMinor,
} from "./money-amount";

describe("parseMadAmountToMinor", () => {
  it("converts 22.50 MAD to exactly 2250 centimes", () => {
    expect(parseMadAmountToMinor("22.50")).toEqual({ ok: true, value: 2250 });
  });

  it("accepts whole amounts, single decimals and comma separators", () => {
    expect(parseMadAmountToMinor("22")).toEqual({ ok: true, value: 2200 });
    expect(parseMadAmountToMinor("22.5")).toEqual({ ok: true, value: 2250 });
    expect(parseMadAmountToMinor("22,50")).toEqual({ ok: true, value: 2250 });
    expect(parseMadAmountToMinor("1 250.00")).toEqual({
      ok: true,
      value: 125000,
    });
  });

  it("rejects empty, negative, zero and over-precise input", () => {
    for (const raw of ["", "   ", "-5", "+5", "0", "0.00", "22.555", "abc", "12.3.4"]) {
      const result = parseMadAmountToMinor(raw);
      expect(result.ok, JSON.stringify(raw)).toBe(false);
    }
  });

  it("rejects amounts above the int4 ledger bound without floating point", () => {
    // 21_474_836.48 MAD = 2_147_483_648 centimes > max.
    const over = parseMadAmountToMinor("21474836.48");
    expect(over.ok).toBe(false);
    expect(parseMadAmountToMinor("21474836.47")).toEqual({
      ok: true,
      value: 2147483647,
    });
  });

  it("rejects non-string input", () => {
    expect(parseMadAmountToMinor(22.5).ok).toBe(false);
    expect(parseMadAmountToMinor(null).ok).toBe(false);
  });
});

describe("MAD formatting", () => {
  it("formats 2250 centimes as 22.50 MAD", () => {
    expect(formatMinorToMad(2250)).toBe("22.50 MAD");
    expect(formatMinorToMadInput(2250)).toBe("22.50");
  });
});
