import { captureNode } from "./capture";
import { LegendTable, loadImage, trimWhitespace, type LegendLayout } from "./legend";
import { PRINT_U, downloadPagePng, newPage, type Box } from "./page";
import type { Electrode } from "../../types";

/**
 * Legend text sizes to try, as fractions of its on-screen size (12 px ≈ 9 pt in
 * print). Smaller sizes are used only when a long legend would crowd the figure.
 */
const LEGEND_SIZES = [1, 0.9, 0.8, 0.7];
/** Shrink the legend text while the figure is drawn smaller than this share of its legend-free size. */
const MIN_FIGURE_SHARE = 0.75;

/**
 * Draw the Planner canvas on an A4 landscape page at 300 dpi, ready to print at 100 %,
 * with the patient label in the top-right corner. Pass `legendElectrodes` to draw the
 * electrode legend (name, entry, target) on the same page; it goes beside or below the
 * figure, whichever leaves the figure larger. The PNG and PDF exports both use this page.
 */
export async function renderPlannerPage(
  node: HTMLElement,
  patientLabel: string,
  legendElectrodes?: Electrode[]
): Promise<HTMLCanvasElement> {
  const { canvas, ctx, area } = newPage("landscape", patientLabel);
  // Capture at about the resolution the figure will be printed at, so it isn't blurred
  // by upscaling.
  const captureScale = Math.min(5, Math.max(3, canvas.width / Math.max(1, node.clientWidth)));
  const figureUrl = await captureNode(node, captureScale);
  const figure = trimWhitespace(await loadImage(figureUrl), 2 * captureScale);

  const electrodes = legendElectrodes ?? [];
  const plan = electrodes.length > 0 ? planWithLegend(figure, electrodes, area) : null;

  if (plan) {
    drawFitted(ctx, figure, plan.figureBox);
    plan.legend.draw(ctx, plan.legendX, plan.legendY, plan.layout);
  } else {
    drawFitted(ctx, figure, area);
  }
  return canvas;
}

/** Export the Planner page (see renderPlannerPage) as a 300 dpi PNG. */
export async function exportWorkspacePng(
  node: HTMLElement,
  filename: string,
  patientLabel: string,
  legendElectrodes?: Electrode[]
) {
  await downloadPagePng(await renderPlannerPage(node, patientLabel, legendElectrodes), filename);
}

/** Base file name for exports: the patient label with spaces as "_", or "seegmap_export". */
export function exportBaseName(patientLabel: string): string {
  const label = patientLabel.trim();
  return label ? label.replace(/\s+/g, "_") : "seegmap_export";
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
