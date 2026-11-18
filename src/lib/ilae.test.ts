import { describe, expect, it } from "vitest";
import { ILAE_GROUPS, ilaeTypeName } from "./ilae";

describe("ILAE 2025 seizure types", () => {
  const all = ILAE_GROUPS.flatMap((g) => g.types);

  it("has unique codes", () => {
    expect(new Set(all.map((t) => t.code)).size).toBe(all.length);
  });

  it("follows Table 1 of the paper, in order", () => {
    expect(all.map((t) => t.code)).toEqual([
      "F", "FPC", "FIC", "FBTC",
      "U", "PC", "IC", "BTC",
      "G", "AS", "TA", "AA", "MA", "EMA", "GTC", "GTC-M", "GTC-A",
      "GM", "GC", "GNM", "GES", "GT", "GA", "GMA",
      "UC",
    ]);
  });

  it("names a type with its abbreviation", () => {
    expect(ilaeTypeName("FIC")).toBe("Focal impaired consciousness seizure (FIC)");
    expect(ilaeTypeName("GTC-A")).toBe("Absence-to-tonic-clonic seizure");
    expect(ilaeTypeName("")).toBe("");
    expect(ilaeTypeName("nope")).toBe("");
  });
});
