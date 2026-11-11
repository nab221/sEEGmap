import { captureNode } from "./capture";
import { LegendTable, loadImage, trimWhitespace, type LegendLayout } from "./legend";
import type { Electrode } from "../../types";

/** Print resolution of the exported page. */
const DPI = 300;
/** A4 landscape, 297 × 210 mm, at DPI. */
const MM = DPI / 25.4;
const PAGE_W = Math.round(297 * MM); // 3508 px
const PAGE_H = Math.round(210 * MM); // 2480 px
/** Margin on every side, wide enough for printers that can't print to the edge. */
const MARGIN = Math.round(10 * MM);
/** Device pixels per CSS pixel at true print size (CSS assumes 96 px per inch). */
const PRINT_U = DPI / 96;
/**
 * Legend text sizes to try, as fractions of its on-screen size (12 px ≈ 9 pt in
 * print). Smaller sizes are used only when a long legend would crowd the figure.
 */
const LEGEND_SIZES = [1, 0.9, 0.8, 0.7];
/** Shrink the legend text while the figure is drawn smaller than this share of its legend-free size. */
const MIN_FIGURE_SHARE = 0.75;

/**
 * Export the canvas as a PNG laid out on an A4 landscape page at 300 dpi, ready to
 * print at 100 %. Pass `legendElectrodes` to draw the electrode legend (name, entry,
 * target) on the same page; it goes beside or below the figure, whichever leaves the
 * figure larger.
 */
export async function exportWorkspacePng(
  node: HTMLElement,
  filename: string,
  legendElectrodes?: Electrode[]
) {
  // Capture at about the resolution the figure will be printed at, so it isn't blurred
  // by upscaling.
  const captureScale = Math.min(5, Math.max(3, PAGE_W / Math.max(1, node.clientWidth)));
  const figureUrl = await captureNode(node, captureScale);
  const figure = trimWhitespace(await loadImage(figureUrl), 2 * captureScale);

  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.imageSmoothingQuality = "high";

  const area = { x: MARGIN, y: MARGIN, w: PAGE_W - MARGIN * 2, h: PAGE_H - MARGIN * 2 };
  const electrodes = legendElectrodes ?? [];
  const plan = electrodes.length > 0 ? planWithLegend(figure, electrodes, area) : null;

  if (plan) {
    drawFitted(ctx, figure, plan.figureBox);
    plan.legend.draw(ctx, plan.legendX, plan.legendY, plan.layout);
  } else {
    drawFitted(ctx, figure, area);
  }

  const blob = await canvasToPngWithDpi(canvas, DPI);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LegendPlan {
  legend: LegendTable;
  layout: LegendLayout;
  legendX: number;
  legendY: number;
  figureBox: Box;
  figureScale: number;
}

/**
 * Choose the legend's text size and placement (left of or below the figure). Keeps the
 * legend at print size unless that would shrink the figure below MIN_FIGURE_SHARE of
 * its legend-free size; otherwise takes whichever option leaves the figure largest.
 */
function planWithLegend(figure: HTMLCanvasElement, electrodes: Electrode[], area: Box): LegendPlan {
  const fullScale = fitScale(figure, area.w, area.h);
  let best: LegendPlan | null = null;

  for (const size of LEGEND_SIZES) {
    const legend = new LegendTable(electrodes, PRINT_U * size);
    const options = [placeLeft(figure, legend, area), placeBelow(figure, legend, area)].filter(
      (p): p is LegendPlan => p !== null
    );
    for (const p of options) {
      if (!best || p.figureScale > best.figureScale) best = p;
    }
    const sizeBest = options.reduce<LegendPlan | null>(
      (a, p) => (!a || p.figureScale > a.figureScale ? p : a),
      null
    );
    if (sizeBest && sizeBest.figureScale >= fullScale * MIN_FIGURE_SHARE) return sizeBest;
  }
  // Even the smallest text crowds the figure (or doesn't fit at all): use the
  // arrangement that leaves the figure largest, falling back to the smallest legend
  // beside the figure.
  return best ?? placeLeft(figure, new LegendTable(electrodes, PRINT_U * LEGEND_SIZES[LEGEND_SIZES.length - 1]), area, true)!;
}

/** Legend in the top-left corner, figure filling the space to its right. */
function placeLeft(figure: HTMLCanvasElement, legend: LegendTable, area: Box, force = false): LegendPlan | null {
  const layout = legend.layoutForHeight(area.h);
  const figW = area.w - layout.width - legend.gap;
  if (!force && (layout.height > area.h || figW <= 0)) return null;
  const figureBox = { x: area.x + layout.width + legend.gap, y: area.y, w: Math.max(1, figW), h: area.h };
  return {
    legend,
    layout,
    legendX: area.x,
    legendY: area.y,
    figureBox,
    figureScale: fitScale(figure, figureBox.w, figureBox.h),
  };
}

/** Figure across the top, legend centred beneath it. */
function placeBelow(figure: HTMLCanvasElement, legend: LegendTable, area: Box): LegendPlan | null {
  const layout = legend.layoutForWidth(area.w);
  const figH = area.h - layout.height - legend.gap;
  if (layout.width > area.w || figH <= 0) return null;
  const figureScale = fitScale(figure, area.w, figH);
  // Close the gap between a short figure and the legend, centring the pair vertically.
  const drawnH = figure.height * figureScale;
  const top = area.y + (figH - drawnH) / 2;
  return {
    legend,
    layout,
    legendX: area.x + (area.w - layout.width) / 2,
    legendY: top + drawnH + legend.gap,
    figureBox: { x: area.x, y: top, w: area.w, h: drawnH },
    figureScale,
  };
}

function fitScale(img: { width: number; height: number }, w: number, h: number) {
  return Math.min(w / img.width, h / img.height);
}

/** Draw `img` as large as fits in `box`, keeping its aspect ratio, centred. */
function drawFitted(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, box: Box) {
  const s = fitScale(img, box.w, box.h);
  const w = img.width * s;
  const h = img.height * s;
  ctx.drawImage(img, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
}

/**
 * Encode the canvas as PNG with a pHYs chunk recording `dpi`, so image viewers and
 * print dialogs size it as a full A4 page rather than guessing at 72 or 96 dpi.
 */
async function canvasToPngWithDpi(canvas: HTMLCanvasElement, dpi: number): Promise<Blob> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png")
  );
  const png = new Uint8Array(await blob.arrayBuffer());

  // The PNG signature (8 bytes) is followed by the IHDR chunk (4 length + 4 type +
  // 13 data + 4 CRC); pHYs must come before the image data, so insert it right after.
  const ihdrEnd = 8 + 25;
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  view.setUint32(17, crc32(chunk.subarray(4, 17)));

  return new Blob([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)], { type: "image/png" });
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
