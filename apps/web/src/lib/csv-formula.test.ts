// @vitest-environment node
import { describe, expect, it } from "vitest";

import { sanitizeCsvFormulaCell, toCsvDocument } from "./csv";

describe("sanitizeCsvFormulaCell", () => {
  it("neutralizes leading formula characters with a text-forcing quote", () => {
    expect(sanitizeCsvFormulaCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(sanitizeCsvFormulaCell("+123")).toBe("'+123");
    expect(sanitizeCsvFormulaCell("-2+3")).toBe("'-2+3");
    expect(sanitizeCsvFormulaCell("@mention")).toBe("'@mention");
    expect(sanitizeCsvFormulaCell("  =2+5")).toBe("'  =2+5");
  });

  it("leaves ordinary text untouched", () => {
    expect(sanitizeCsvFormulaCell("Coffee shop")).toBe("Coffee shop");
    expect(sanitizeCsvFormulaCell("22.50 MAD")).toBe("22.50 MAD");
    expect(sanitizeCsvFormulaCell("")).toBe("");
  });
});

describe("toCsvDocument with formula neutralization", () => {
  it("escapes formula cells and quote/newline cells together", () => {
    const csv = toCsvDocument(
      ["note", "amount"],
      [
        ["=SUM(A1:A2)", 2250],
        ['He said "hi"\nthen left', 100],
        ["@handle", 50],
      ],
    );
    expect(csv).toContain("'=SUM(A1:A2)");
    expect(csv).toContain("'@handle");
    expect(csv).toContain('"He said ""hi""\nthen left"');
    expect(csv).toContain("2250");
  });
});
