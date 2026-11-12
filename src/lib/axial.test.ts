import { describe, expect, it } from "vitest";
import type { AxialPlacement, Point, Tissue } from "../types";
import type { AxialViewConfig } from "./axialViews";
import {
  contactPositions,
  cycleContact,
  defaultAxialPlacement,
  formatTissueRanges,
  handlePosition,
  hemisphereOf,
  mirrorAxial,
  effectiveTissue,
  nextTissue,
  normalizeAxial,
  resizeTissue,
  setLastInBrain,
  translateAxial,
  withContactCount,
} from "./axial";
import { viewPickerOrder } from "./axialViews";

// 3.5 mm / 0.35 mm per px = 10 px contact spacing.
const V: AxialViewConfig = {
  id: "superior",
  kind: "axial",
  label: "",
  fileSlug: "",
  imageFile: "",
  margin: { x: 0.2, y: 0.06 },
  width: 400,
  height: 500,
  midlineX: 200,
  mmPerPx: 0.35,
  patientLeftOnViewerLeft: true,
};
const VI: AxialViewConfig = { ...V, id: "inferior", patientLeftOnViewerLeft: false };
const VL: AxialViewConfig = {
  ...V,
  id: "leftLateral",
  kind: "sagittal",
  hemisphere: "L",
  counterpart: "rightLateral",
};

const p: AxialPlacement = {
  view: "superior",
  tip: { x: 0.25, y: 0.5 },
  toward: { x: 0, y: 0.5 },
  contacts: 3,
  tissue: ["grey", "grey", "grey"],
};

function expectPoint(actual: Point, expected: Point) {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

const pxDist = (a: Point, b: Point, v: AxialViewConfig) =>
  Math.hypot((a.x - b.x) * v.width, (a.y - b.y) * v.height);

describe("contactPositions", () => {
  it("spaces contacts 3.5 mm apart outward from the tip", () => {
    const pts = contactPositions(p, V);
    expect(pts).toHaveLength(3);
    expectPoint(pts[0], { x: 0.25, y: 0.5 });
    expectPoint(pts[1], { x: 0.225, y: 0.5 });
    expectPoint(pts[2], { x: 0.2, y: 0.5 });
  });

  it("keeps 10 px spacing on a diagonal in a non-square image", () => {
    const pts = contactPositions({ ...p, tip: { x: 0.5, y: 0.5 }, toward: { x: 0.6, y: 0.58 } }, V);
    expect(pxDist(pts[0], pts[1], V)).toBeCloseTo(10, 6);
    expect(pxDist(pts[1], pts[2], V)).toBeCloseTo(10, 6);
  });

  it("draws every contact, even past the image edge", () => {
    const pts = contactPositions(
      { ...p, tip: { x: 0.02, y: 0.5 }, contacts: 5, tissue: Array(5).fill("grey") },
      V
    );
    expect(pts).toHaveLength(5);
    expect(pts[4].x).toBeLessThan(0);
  });

  it("points away from the midline when tip and toward coincide", () => {
    const pts = contactPositions({ ...p, tip: { x: 0.3, y: 0.5 }, toward: { x: 0.3, y: 0.5 } }, V);
    expect(pts[1].x).toBeLessThan(0.3);
    const right = contactPositions({ ...p, tip: { x: 0.7, y: 0.5 }, toward: { x: 0.7, y: 0.5 } }, V);
    expect(right[1].x).toBeGreaterThan(0.7);
  });
});

describe("handlePosition", () => {
  it("sits one spacing past the last contact", () => {
    expectPoint(handlePosition(p, V), { x: 0.175, y: 0.5 });
  });
});

describe("tissue", () => {
  it("cycles grey → white → noisy → outside → grey when outside is clickable", () => {
    expect(nextTissue("grey", true)).toBe("white");
    expect(nextTissue("white", true)).toBe("noisy");
    expect(nextTissue("noisy", true)).toBe("outside");
    expect(nextTissue("outside", true)).toBe("grey");
  });

  it("cycles grey → white → noisy → grey when the dropdown owns outside", () => {
    expect(nextTissue("noisy", false)).toBe("grey");
    expect(nextTissue("outside", false)).toBe("white");
  });

  it("resizes keeping marks and padding with grey, clamped to 1..24", () => {
    expect(resizeTissue(["white", "outside"], 4)).toEqual(["white", "outside", "grey", "grey"]);
    expect(resizeTissue(["white", "outside"], 1)).toEqual(["white"]);
    expect(resizeTissue(["white", "outside"], 0)).toHaveLength(1);
    expect(resizeTissue(["white", "outside"], 30)).toHaveLength(24);
  });

  it("normalizes malformed placements", () => {
    expect(normalizeAxial({ ...p, contacts: 3, tissue: ["white", "bogus" as Tissue] })!.tissue).toEqual([
      "white",
      "grey",
      "grey",
    ]);
    expect(normalizeAxial({ ...p, contacts: NaN })!.contacts).toBe(10);
    expect(normalizeAxial({ ...p, contacts: 3.6 })!.contacts).toBe(4);
    expect(normalizeAxial({ ...p, contacts: 99 })!.contacts).toBe(24);
  });

  it("reads a numeric-string contact count instead of resetting it", () => {
    const fromFile = { ...p, contacts: "15" as unknown as number, tissue: [] };
    expect(normalizeAxial(fromFile)!.contacts).toBe(15);
  });

  it("returns null for a placement it cannot draw", () => {
    const broken = (patch: object) => ({ ...p, ...patch }) as unknown as AxialPlacement;
    expect(normalizeAxial(broken({ tip: undefined }))).toBeNull();
    expect(normalizeAxial(broken({ tip: { x: NaN, y: 0.5 } }))).toBeNull();
    expect(normalizeAxial(broken({ view: "axial-left" }))).toBeNull();
    expect(normalizeAxial(null as unknown as AxialPlacement)).toBeNull();
  });

  it("repairs a missing direction by pointing the shaft along the tip", () => {
    const n = normalizeAxial({ ...p, toward: undefined } as unknown as AxialPlacement)!;
    expect(n.toward).toEqual(n.tip);
    expect(contactPositions(n, V)).toHaveLength(3);
  });

  it("cycles one contact, ignoring out-of-range indexes", () => {
    expect(cycleContact(p, 1).tissue).toEqual(["grey", "white", "grey"]);
    expect(cycleContact(p, 9)).toEqual(p);
  });

  it("changes the contact count keeping existing marks", () => {
    const marked: AxialPlacement = { ...p, tissue: ["outside", "white", "grey"] };
    const two = withContactCount(marked, 2);
    expect(two.contacts).toBe(2);
    expect(two.tissue).toEqual(["outside", "white"]);
    const five = withContactCount(marked, 5);
    expect(five.contacts).toBe(5);
    expect(five.tissue).toEqual(["outside", "white", "grey", "grey", "grey"]);
  });
});

describe("last contact in brain", () => {
  const p5: AxialPlacement = {
    ...p,
    contacts: 5,
    tissue: ["grey", "outside", "white", "grey", "noisy"],
  };

  it("reads contacts above N as outside and stored outside below it as grey", () => {
    expect(effectiveTissue({ ...p5, lastInBrain: 3 })).toEqual(["grey", "grey", "white", "outside", "outside"]);
  });

  it("returns stored marks unchanged when it isn't set", () => {
    expect(effectiveTissue(p5)).toEqual(["grey", "outside", "white", "grey", "noisy"]);
  });

  it("ignores clicks on contacts it marks outside", () => {
    const set = { ...p5, lastInBrain: 3 };
    expect(cycleContact(set, 3)).toEqual(set);
    expect(cycleContact(set, 0).tissue[0]).toBe("white");
    expect(cycleContact(set, 1).tissue[1]).toBe("white");
  });

  it("clamps to a lowered contact count", () => {
    expect(withContactCount({ ...p5, lastInBrain: 5 }, 3).lastInBrain).toBe(3);
    expect(withContactCount({ ...p5, lastInBrain: 2 }, 4).lastInBrain).toBe(2);
  });

  it("sets, rounds and clears", () => {
    expect(setLastInBrain(p5, 2.6).lastInBrain).toBe(3);
    expect(setLastInBrain(p5, 9).lastInBrain).toBe(5);
    expect("lastInBrain" in setLastInBrain({ ...p5, lastInBrain: 2 }, undefined)).toBe(false);
    expect("lastInBrain" in setLastInBrain(p5, 0)).toBe(false);
    expect("lastInBrain" in setLastInBrain(p5, NaN)).toBe(false);
  });

  it("is normalized from storage", () => {
    expect(normalizeAxial({ ...p5, lastInBrain: 4 })!.lastInBrain).toBe(4);
    expect(normalizeAxial({ ...p5, lastInBrain: 99 })!.lastInBrain).toBe(5);
    expect(normalizeAxial({ ...p5, lastInBrain: "x" as unknown as number })!.lastInBrain).toBeUndefined();
    expect(normalizeAxial({ ...p5, edgeDist: -4 })!.edgeDist).toBeUndefined();
    expect(normalizeAxial({ ...p5, edgeDist: 12.5 })!.edgeDist).toBe(12.5);
    expect(normalizeAxial({ ...p5, view: "rightMedial" })!.view).toBe("rightMedial");
  });

  it("leaves an old-format placement exactly as it was", () => {
    const old: AxialPlacement = {
      view: "inferior",
      tip: { x: 0.4, y: 0.5 },
      toward: { x: 0.6, y: 0.5 },
      contacts: 4,
      tissue: ["grey", "white", "outside", "outside"],
    };
    expect(normalizeAxial(old)).toEqual(old);
  });
});

describe("defaultAxialPlacement", () => {
  it("drops a sagittal electrode near the centre pointing up, keeping the dropdown but not the edge", () => {
    const d = defaultAxialPlacement(VL, "L", { contacts: 15, tissue: [], lastInBrain: 12 });
    expect(d.view).toBe("leftLateral");
    expectPoint(d.tip, { x: 0.5, y: 0.55 });
    expect(d.toward.y).toBeLessThan(d.tip.y);
    expect(d.contacts).toBe(15);
    expect(d.lastInBrain).toBe(12);
    expect(d.edgeDist).toBeUndefined();
  });

  it("puts a left electrode on the viewer's left from above, pointing outward", () => {
    const d = defaultAxialPlacement(V, "L");
    expect(d.view).toBe("superior");
    expect(d.tip.x).toBeLessThan(0.5);
    expect(d.toward.x).toBeLessThan(d.tip.x);
    expect(d.contacts).toBe(10);
    expect(d.tissue).toEqual(Array(10).fill("grey"));
  });

  it("puts a left electrode on the viewer's right from below", () => {
    const d = defaultAxialPlacement(VI, "L");
    expect(d.view).toBe("inferior");
    expect(d.tip.x).toBeGreaterThan(0.5);
    expect(d.toward.x).toBeGreaterThan(d.tip.x);
  });

  it("puts right on the viewer's right from above, and unknown on the left", () => {
    expect(defaultAxialPlacement(V, "R").tip.x).toBeGreaterThan(0.5);
    expect(defaultAxialPlacement(V, null).tip.x).toBeLessThan(0.5);
  });

  it("keeps contacts and marks when given", () => {
    const d = defaultAxialPlacement(V, "L", { contacts: 3, tissue: ["white", "white", "outside"] });
    expect(d.contacts).toBe(3);
    expect(d.tissue).toEqual(["white", "white", "outside"]);
  });
});

describe("mirrorAxial", () => {
  it("moves a sagittal placement to the other hemisphere's view", () => {
    const m = mirrorAxial(
      {
        ...p,
        view: "leftLateral",
        tip: { x: 0.3, y: 0.4 },
        toward: { x: 0.3, y: 0.2 },
        lastInBrain: 2,
        edgeDist: 40,
      },
      VL
    );
    expect(m.view).toBe("rightLateral");
    expectPoint(m.tip, { x: 0.7, y: 0.4 });
    expectPoint(m.toward, { x: 0.7, y: 0.2 });
    expect(m.lastInBrain).toBe(2);
    expect(m.edgeDist).toBe(40);
  });

  it("reflects across the view's midline, keeping contacts and marks", () => {
    const marked: AxialPlacement = { ...p, tissue: ["white", "grey", "outside"] };
    const m = mirrorAxial(marked, V);
    expect(m.tip.x).toBeCloseTo(0.75, 9);
    expect(m.toward.x).toBeCloseTo(1, 9);
    expect(m.tip.y).toBe(0.5);
    expect(m.contacts).toBe(3);
    expect(m.tissue).toEqual(["white", "grey", "outside"]);
  });

  it("uses the measured midline, not the image centre", () => {
    expect(mirrorAxial(p, { ...V, midlineX: 210 }).tip.x).toBeCloseTo(0.8, 9);
  });
});

describe("translateAxial", () => {
  it("moves tip and toward together", () => {
    const t = translateAxial(p, 0.1, -0.1);
    expectPoint(t.tip, { x: 0.35, y: 0.4 });
    expectPoint(t.toward, { x: 0.1, y: 0.4 });
  });
});

describe("viewPickerOrder", () => {
  it("lists the axial views, then the electrode's own side, then the other", () => {
    expect(viewPickerOrder("R")).toEqual([
      "inferior",
      "superior",
      "rightLateral",
      "rightMedial",
      "leftLateral",
      "leftMedial",
    ]);
    expect(viewPickerOrder(null)).toEqual([
      "inferior",
      "superior",
      "leftLateral",
      "leftMedial",
      "rightLateral",
      "rightMedial",
    ]);
  });
});

describe("hemisphereOf", () => {
  it("reads the leading L/R", () => {
    expect(hemisphereOf("LTMI")).toBe("L");
    expect(hemisphereOf("rpf")).toBe("R");
    expect(hemisphereOf("XYZ")).toBeNull();
    expect(hemisphereOf("")).toBeNull();
  });
});

describe("formatTissueRanges", () => {
  it("groups runs per state in grey, white, outside order", () => {
    expect(formatTissueRanges(["grey", "grey", "grey", "white", "white", "grey", "outside"])).toBe(
      "grey 1–3, 6 · white 4–5 · outside 7"
    );
  });

  it("lists noisy between white and outside", () => {
    expect(formatTissueRanges(["grey", "noisy", "outside"])).toBe("grey 1 · noisy 2 · outside 3");
  });

  it("handles one state, one contact and none", () => {
    expect(formatTissueRanges(Array(10).fill("grey"))).toBe("grey 1–10");
    expect(formatTissueRanges(["white"])).toBe("white 1");
    expect(formatTissueRanges([])).toBe("");
  });
});
