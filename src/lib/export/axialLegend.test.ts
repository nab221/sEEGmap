import { describe, expect, it } from "vitest";
import type { AxialPlacement, Electrode, Tissue } from "../../types";
import { axialLegendEntries } from "./axialLegend";
import { exportBaseName } from "./png";

const base = {
  color: "#000",
  entryName: "",
  targetName: "",
  notes: "",
  showTarget: true,
  createdAt: "",
  updatedAt: "",
};

const axial = (tissue: Tissue[]): AxialPlacement => ({
  view: "inferior",
  tip: { x: 0.5, y: 0.5 },
  toward: { x: 0.6, y: 0.5 },
  contacts: tissue.length,
  tissue,
});

function lm(id: string, name: string, order: number, a?: AxialPlacement): Electrode {
  return { ...base, id, name, order, type: "lateral-medial", entry: { x: 0, y: 0 }, target: { x: 0, y: 0 }, axial: a };
}

const grid: Electrode = {
  ...base,
  id: "g",
  name: "LGRID",
  order: 0,
  type: "grid",
  rows: 2,
  cols: 4,
  center: { x: 0.5, y: 0.5 },
  width: 0.1,
  height: 0.05,
  rotation: 0,
  contactNumbers: false,
};

describe("axialLegendEntries", () => {
  it("lists placed depth electrodes in plan order with Planner letters", () => {
    const all = [
      lm("b", "RTAI", 2, axial(["grey", "white"])),
      grid,
      lm("a", "LTMI", 1, axial(["grey", "grey", "outside"])),
      lm("c", "LFAS", 3),
    ];
    const entries = axialLegendEntries(all);
    expect(entries.map((e) => [e.letter, e.electrode.name, e.ranges])).toEqual([
      ["B", "LTMI", "grey 1–2 · outside 3"],
      ["C", "RTAI", "grey 1 · white 2"],
    ]);
  });

  it("repairs malformed placements before formatting", () => {
    const bad = { ...axial(["white"]), contacts: 3 };
    expect(axialLegendEntries([lm("a", "LTMI", 0, bad)])[0].ranges).toBe("grey 2–3 · white 1");
  });

  it("leaves out placements that cannot be drawn", () => {
    const broken = { ...axial(["grey"]), view: "axial-left" } as unknown as AxialPlacement;
    expect(axialLegendEntries([lm("a", "LTMI", 0, broken)])).toEqual([]);
  });

  it("lists only one view's electrodes when asked, keeping whole-plan letters", () => {
    const lateral = { ...axial(["grey"]), view: "leftLateral" as const };
    const all = [lm("a", "LTMI", 0, axial(["grey"])), lm("b", "LSFOF", 1, lateral)];
    expect(axialLegendEntries(all, "leftLateral").map((e) => [e.letter, e.electrode.name])).toEqual([["B", "LSFOF"]]);
    expect(axialLegendEntries(all, "inferior").map((e) => e.electrode.name)).toEqual(["LTMI"]);
  });

  it("lists contacts after the last one in brain as outside", () => {
    const a = { ...axial(["grey", "white", "grey"]), lastInBrain: 2 };
    expect(axialLegendEntries([lm("a", "LTMI", 0, a)])[0].ranges).toBe("grey 1 · white 2 · outside 3");
  });

  it("is empty when nothing is placed", () => {
    expect(axialLegendEntries([lm("a", "LTMI", 0), grid])).toEqual([]);
  });
});

describe("exportBaseName", () => {
  it("uses the patient label with spaces as underscores, or a default", () => {
    expect(exportBaseName("  Case 12  B ")).toBe("Case_12_B");
    expect(exportBaseName("   ")).toBe("seegmap_export");
  });
});
