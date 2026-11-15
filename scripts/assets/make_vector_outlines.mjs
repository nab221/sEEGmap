#!/usr/bin/env node
/**
 * Trace the Electrode view outlines (public/axial-*.png, public/view-*.png) into vector
 * SVGs, so the drawing stays sharp however far the page is zoomed and in exports.
 *
 *     node scripts/assets/make_vector_outlines.mjs
 *
 * Writes public/<same name>.svg next to each PNG. Each SVG keeps the PNG's size in its
 * width/height and draws in an upscaled viewBox, so it lays exactly over the PNG's pixel
 * coordinates. The PNGs stay: the brain mask is still built from them (useBrainMask).
 *
 * How it traces:
 *  - Each image is upscaled (bicubic) first, so potrace fits smooth curves to the
 *    anti-aliased strokes rather than to the pixel staircase.
 *  - Ink: dark, near-neutral pixels, traced as one black layer drawn on top. The axial
 *    outlines draw their gyral detail in light grey, so they use a lighter ink threshold
 *    and those lines come out as clean black strokes too.
 *  - Fills: the coloured / grey patches (insula, amygdala, hippocampus, thalamus). Pixels
 *    that are neither paper nor ink are grouped by hue into families (plus one neutral
 *    grey family). Each is traced as a flat shape in its average colour; a shaded patch
 *    (the insula) gets its darkest pixels, including outline seen through it, as a
 *    second, darker tone on top rather than as black ink.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Jimp from "jimp";
import potrace from "potrace";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUBLIC = path.join(ROOT, "public");

/** Target long edge for tracing, in px: about 4x the axial outlines, 1.5x the sagittal ones. */
const TRACE_LONG_EDGE = 2400;
/** Luminance (0..255) at or above which a near-neutral pixel is paper. */
const PAPER_LUM = 236;
/** Luminance below which a near-neutral pixel is ink. Sets the traced stroke weight. */
const INK_LUM = 170;
/** Ink threshold for the axial outlines, whose detail lines are light grey. */
const AXIAL_INK_LUM = 222;
/** max(r,g,b) - min(r,g,b) at or above which a pixel counts as coloured. */
const CHROMA_MIN = 24;
/** A hue bin (10 degrees) needs this share of the coloured pixels to start a family. */
const HUE_BIN_SHARE = 0.01;
/** Neutral-grey fill must survive an opening of this radius (native px): drops stroke fringes. */
const GREY_OPEN_PX = 4;
/** Opening radius (native px) for coloured fills: drops stray tinted pixels. */
const COLOUR_OPEN_PX = 1.5;
/** Closing radius (native px) for fills: bridges the gaps where strokes cross them. */
const FILL_CLOSE_PX = 3;
/** Closing radius (native px) that gives a shaded patch's whole area, lines through it included. */
const PATCH_HULL_PX = 14;
/** Blur (native px) before tracing: evens out strokes whose darkness wobbles along their length. */
const SMOOTH_PX = 0.4;
/** Smallest fill blob kept, in native px². */
const MIN_FILL_AREA = 400;

const FILES = [
  "axial-inferior.png",
  "axial-superior.png",
  "view-left-lateral.png",
  "view-left-medial.png",
  "view-right-lateral.png",
  "view-right-medial.png",
];

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

function hueOf(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min || 1;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Morphology on a 0/1 mask with a square window, via a summed-area table. */
function boxMorph(mask, w, h, r, op) {
  r = Math.max(0, Math.round(r));
  if (r === 0) return mask.slice();
  const W1 = w + 1;
  const sat = new Int32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += mask[y * w + x];
      sat[(y + 1) * W1 + x + 1] = sat[y * W1 + x + 1] + row;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const s = sat[y1 * W1 + x1] - sat[y0 * W1 + x1] - sat[y1 * W1 + x0] + sat[y0 * W1 + x0];
      out[y * w + x] = op === "erode" ? (s === (x1 - x0) * (y1 - y0) ? 1 : 0) : s > 0 ? 1 : 0;
    }
  }
  return out;
}
const open = (m, w, h, r) => boxMorph(boxMorph(m, w, h, r, "erode"), w, h, r, "dilate");
const close = (m, w, h, r) => boxMorph(boxMorph(m, w, h, r, "dilate"), w, h, r, "erode");

/** Trace a 0/1 mask (1 = shape) and return potrace's <path>, filled with `color`. */
async function traceMask(mask, w, h, color, turdSize) {
  const img = new Jimp(w, h, 0xffffffff);
  const d = img.bitmap.data;
  for (let k = 0; k < mask.length; k++) {
    if (!mask[k]) continue;
    d[4 * k] = d[4 * k + 1] = d[4 * k + 2] = 0;
  }
  const t = new potrace.Potrace({
    threshold: 128,
    blackOnWhite: true,
    turdSize,
    alphaMax: 1,
    optCurve: true,
    optTolerance: 0.4,
    color,
    background: "transparent",
  });
  await new Promise((resolve, reject) => t.loadImage(img, (err) => (err ? reject(err) : resolve())));
  // One decimal of a traced pixel is far below what any zoom shows, and trims the file.
  return t.getPathTag().replace(/(\d+\.\d)\d+/g, "$1");
}

const hex = (v) => Math.round(v).toString(16).padStart(2, "0");

/** Average colour of the pixels where `sel` is set, as #rrggbb. */
function meanColour(data, sel) {
  let n = 0, r = 0, g = 0, b = 0;
  for (let k = 0; k < sel.length; k++) {
    if (!sel[k]) continue;
    n++;
    r += data[4 * k];
    g += data[4 * k + 1];
    b += data[4 * k + 2];
  }
  return n ? `#${hex(r / n)}${hex(g / n)}${hex(b / n)}` : null;
}

/** Hue families: centre hue of each run of well-populated 10-degree bins, wrapping round 360. */
function hueFamilies(hues) {
  const bins = new Array(36).fill(0);
  for (const h of hues) bins[Math.floor(h / 10) % 36]++;
  const busy = bins.map((c) => c >= HUE_BIN_SHARE * hues.length && c > 0);
  if (!busy.some(Boolean)) return [];
  const start = Math.max(0, busy.findIndex((b, i) => b && !busy[(i + 35) % 36]));
  const runs = [];
  let cur = null;
  for (let j = 0; j < 36; j++) {
    const i = (start + j) % 36;
    if (busy[i]) {
      if (!cur) runs.push((cur = []));
      cur.push(i);
    } else cur = null;
  }
  return runs.map((f) => (f[0] * 10 + (f.length * 10) / 2) % 360);
}

const hueDist = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

for (const file of FILES) {
  const src = path.join(PUBLIC, file);
  const img = await Jimp.read(src);
  const { width, height } = img.bitmap;
  const scale = Math.max(1, TRACE_LONG_EDGE / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const work = img.clone().resize(w, h, Jimp.RESIZE_BICUBIC);
  const blur = Math.round(SMOOTH_PX * scale);
  if (blur > 0) work.blur(blur);
  const data = work.bitmap.data;
  const n = w * h;

  // Classify every pixel.
  const inkLum = file.startsWith("axial-") ? AXIAL_INK_LUM : INK_LUM;
  const ink = new Uint8Array(n);
  const grey = new Uint8Array(n);
  const L = new Float32Array(n);
  const chromaticIdx = [];
  const chromaticHue = [];
  for (let k = 0; k < n; k++) {
    const r = data[4 * k], g = data[4 * k + 1], b = data[4 * k + 2];
    const l = lum(r, g, b);
    L[k] = l;
    if (Math.max(r, g, b) - Math.min(r, g, b) >= CHROMA_MIN) {
      chromaticIdx.push(k);
      chromaticHue.push(hueOf(r, g, b));
    } else if (l < inkLum) ink[k] = 1;
    else if (l < PAPER_LUM) grey[k] = 1;
  }

  // Fill families: one per hue run, plus neutral grey.
  const centres = hueFamilies(chromaticHue);
  const families = centres.map(() => new Uint8Array(n));
  chromaticIdx.forEach((k, j) => {
    let best = 0;
    centres.forEach((c, i) => {
      if (hueDist(chromaticHue[j], c) < hueDist(chromaticHue[j], centres[best])) best = i;
    });
    if (centres.length) families[best][k] = 1;
  });
  const colourFills = families.map((m) => close(open(m, w, h, COLOUR_OPEN_PX * scale), w, h, FILL_CLOSE_PX * scale));
  const fills = [close(open(grey, w, h, GREY_OPEN_PX * scale), w, h, FILL_CLOSE_PX * scale), ...colourFills];
  // Dark pixels inside a coloured patch (its shading, or outline seen through it) belong
  // to the patch's dark tone, not to the black ink.
  for (const fam of colourFills) {
    const hull = close(fam, w, h, PATCH_HULL_PX * scale);
    for (let k = 0; k < n; k++) {
      if (hull[k] && ink[k]) {
        ink[k] = 0;
        fam[k] = 1;
      }
    }
  }

  const turdFill = Math.round(MIN_FILL_AREA * scale * scale);
  const layers = [];
  let fillLayers = 0;
  for (const fam of fills) {
    // Tone levels: the whole family, then its darker parts on top (posterized by luminance).
    const ls = [];
    for (let k = 0; k < n; k++) if (fam[k] && !ink[k]) ls.push(L[k]);
    if (ls.length < turdFill) continue;
    ls.sort((a, b) => a - b);
    const q = (p) => ls[Math.floor(p * (ls.length - 1))];
    const shaded = q(0.9) - q(0.1) > 30;
    const cuts = shaded ? [Infinity, q(0.12)] : [Infinity];
    for (let i = 0; i < cuts.length; i++) {
      const hi = cuts[i];
      const lo = cuts[i + 1] ?? -Infinity;
      const level = new Uint8Array(n);
      const band = new Uint8Array(n);
      for (let k = 0; k < n; k++) {
        if (!fam[k] || L[k] >= hi) continue;
        level[k] = 1;
        // A shaded patch's base tone is its lighter half: the average reads too dark.
        if (L[k] >= (shaded && i === 0 ? q(0.4) : lo) && !ink[k]) band[k] = 1;
      }
      const colour = meanColour(data, band);
      if (!colour) continue;
      const shape = i === 0 ? level : open(level, w, h, scale);
      layers.push(await traceMask(shape, w, h, colour, i === 0 ? turdFill : Math.round(turdFill / 8)));
      fillLayers++;
    }
  }
  layers.push(await traceMask(ink, w, h, "#000000", Math.round(8 * scale)));

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${layers.join("")}</svg>\n`;
  const out = path.join(PUBLIC, file.replace(/\.png$/, ".svg"));
  fs.writeFileSync(out, svg);
  console.log(
    `${path.basename(out)}  ${width}x${height}  traced at ${w}x${h}  ` +
      `${fillLayers} fill layer(s)  ${(svg.length / 1024).toFixed(0)} KB`
  );
}
