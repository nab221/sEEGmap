import { describe, expect, it } from "vitest";
import { buildBrainMask, findCrossingPx, isBrain } from "./brainMask";

/** "#" is a black pixel, "." a white one. */
function img(rows: string[]) {
  const height = rows.length;
  const width = rows[0].length;
  const rgba = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const v = ch === "#" ? 0 : 255;
      rgba.set([v, v, v, 255], (y * width + x) * 4);
    })
  );
  return { rgba, width, height };
}

const ring = img([
  ".........",
  ".#######.",
  ".#.....#.",
  ".#.....#.",
  ".#.....#.",
  ".#.....#.",
  ".#.....#.",
  ".#######.",
  ".........",
]);

describe("buildBrainMask", () => {
  it("counts the outline and everything it encloses as brain", () => {
    const m = buildBrainMask(ring.rgba, ring.width, ring.height);
    expect(isBrain(m, 1, 1)).toBe(true);
    expect(isBrain(m, 4, 4)).toBe(true);
    expect(isBrain(m, 0, 0)).toBe(false);
    expect(isBrain(m, 8, 8)).toBe(false);
  });

  it("lets the background in through a gap in the outline", () => {
    const open = img([
      ".........",
      ".#######.",
      ".#.....#.",
      ".#.......",
      ".#.....#.",
      ".#######.",
      ".........",
    ]);
    const m = buildBrainMask(open.rgba, open.width, open.height);
    expect(isBrain(m, 4, 3)).toBe(false);
    expect(isBrain(m, 1, 1)).toBe(true);
  });

  it("does not leak through a one-pixel diagonal wall", () => {
    const diag = img([
      "........",
      "...#....",
      "..#.#...",
      ".#...#..",
      "..#.#...",
      "...#....",
      "........",
    ]);
    const m = buildBrainMask(diag.rgba, diag.width, diag.height);
    expect(isBrain(m, 3, 3)).toBe(true);
  });

  it("treats sealed rectangles as outline, closing a shape cut off by the image edge", () => {
    const cut = img([
      ".#.....#.",
      ".#.....#.",
      ".#.....#.",
      ".#######.",
      ".........",
    ]);
    expect(isBrain(buildBrainMask(cut.rgba, cut.width, cut.height), 4, 1)).toBe(false);
    const sealed = buildBrainMask(cut.rgba, cut.width, cut.height, 230, [[1, 0, 7, 0]]);
    expect(isBrain(sealed, 4, 1)).toBe(true);
    expect(isBrain(sealed, 0, 0)).toBe(false);
  });

  it("is never brain off the image", () => {
    const m = buildBrainMask(ring.rgba, ring.width, ring.height);
    expect(isBrain(m, -1, 0)).toBe(false);
    expect(isBrain(m, ring.width, 0)).toBe(false);
  });
});

describe("findCrossingPx", () => {
  const m = buildBrainMask(ring.rgba, ring.width, ring.height);

  it("finds the first exit from the brain along the shaft", () => {
    const d = findCrossingPx(m, { x: 4.5, y: 4.5 }, { x: 1, y: 0 }, 20)!;
    expect(d).toBeGreaterThanOrEqual(3);
    expect(d).toBeLessThanOrEqual(4);
  });

  it("returns null when the tip is outside the brain", () => {
    expect(findCrossingPx(m, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }, 20)).toBeNull();
  });

  it("returns null when no exit is found within the limit", () => {
    expect(findCrossingPx(m, { x: 4.5, y: 4.5 }, { x: 1, y: 0 }, 2)).toBeNull();
  });
});
