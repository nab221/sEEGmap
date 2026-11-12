// Which pixels of an outline image are brain, and where a shaft leaves it.
//
// Brain is everything the white paper at the image border can't reach: the outline
// strokes themselves and every area they enclose (the brainstem cut-out, the inside of
// the corpus callosum curve). Gaps that open to the border -- the notch under the frontal
// lobe, the space between the hemispheres -- are background.

import type { Point } from "../types";

export interface BrainMask {
  width: number;
  height: number;
  /** 1 = brain, 0 = background; row-major. */
  data: Uint8Array;
}

/** Inclusive pixel rectangle [x0, y0, x1, y1]. */
export type PixelRect = [number, number, number, number];

/**
 * Flood-fill the white background in from the image border (4-connected, so a one-pixel
 * diagonal stroke still closes a shape) and call everything else brain. `seals` are
 * rectangles treated as outline, for an outline the image crops off at its edge.
 */
export function buildBrainMask(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  whiteMin = 230,
  seals: PixelRect[] = []
): BrainMask {
  const n = width * height;
  const white = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const i = k * 4;
    white[k] = rgba[i] >= whiteMin && rgba[i + 1] >= whiteMin && rgba[i + 2] >= whiteMin ? 1 : 0;
  }
  for (const [x0, y0, x1, y1] of seals) {
    for (let y = Math.max(0, y0); y <= Math.min(height - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x++) white[y * width + x] = 0;
    }
  }

  const background = new Uint8Array(n);
  const stack = new Int32Array(n);
  let top = 0;
  const push = (k: number) => {
    if (white[k] && !background[k]) {
      background[k] = 1;
      stack[top++] = k;
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (top > 0) {
    const k = stack[--top];
    const x = k % width;
    if (x > 0) push(k - 1);
    if (x < width - 1) push(k + 1);
    if (k >= width) push(k - width);
    if (k < n - width) push(k + width);
  }

  const data = new Uint8Array(n);
  for (let k = 0; k < n; k++) data[k] = background[k] ? 0 : 1;
  return { width, height, data };
}

/** Whether native pixel (x, y) is brain. Off the image is never brain. */
export function isBrain(mask: BrainMask, x: number, y: number): boolean {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) return false;
  return mask.data[py * mask.width + px] === 1;
}

/**
 * Distance from the tip (native px) along the unit direction `dir` to the first sample
 * that isn't brain. Null when the tip itself isn't brain, or no exit is found within
 * `maxDistPx`.
 */
export function findCrossingPx(
  mask: BrainMask,
  tipPx: Point,
  dir: Point,
  maxDistPx: number,
  stepPx = 0.5
): number | null {
  if (!isBrain(mask, tipPx.x, tipPx.y)) return null;
  for (let d = stepPx; d <= maxDistPx; d += stepPx) {
    if (!isBrain(mask, tipPx.x + dir.x * d, tipPx.y + dir.y * d)) return d;
  }
  return null;
}
