// One Electrode view as its own PNG for a clinical report: the outline with its
// electrodes, and that view's legend and dot key underneath. Editing handles are left out.

import { captureNode } from "./capture";
import { loadImage, trimWhitespace } from "./legend";
import { canvasToPngWithDpi, downloadBlob } from "./png";
import { DPI, PRINT_U, buildLegendParts, type AxialLegendEntry } from "./axialLegend";

/** Width the figure is captured at, in device px (about 135 mm at 300 dpi). */
const FIGURE_W = 1600;
const GAP = 40;
const PAD = 48;

/** Elements drawn only for editing (rotate handle, edge bar) carry this class. */
const EDIT_ONLY = "edit-only";

/**
 * Capture `node` with its editing handles hidden. They are hidden inline, not filtered:
 * html-to-image copies an <svg> whole without consulting its filter, and stylesheets don't
 * travel with the copy.
 */
async function captureWithoutHandles(node: HTMLElement, ratio: number): Promise<string> {
  const handles = [...node.querySelectorAll<SVGElement | HTMLElement>(`.${EDIT_ONLY}`)];
  const before = handles.map((el) => el.style.display);
  handles.forEach((el) => (el.style.display = "none"));
  try {
    return await captureNode(node, ratio);
  } finally {
    handles.forEach((el, i) => (el.style.display = before[i]));
  }
}

export async function exportElectrodeViewPng(
  node: HTMLElement,
  entries: AxialLegendEntry[],
  filename: string
): Promise<void> {
  const ratio = FIGURE_W / Math.max(1, node.clientWidth);
  const figure = trimWhitespace(await loadImage(await captureWithoutHandles(node, ratio)), 8 * ratio);
  const legend = buildLegendParts(entries, PRINT_U);

  const width = Math.ceil(Math.max(figure.width, legend.width) + PAD * 2);
  const height = Math.ceil(PAD * 2 + figure.height + GAP + legend.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(figure, Math.round((width - figure.width) / 2), PAD);
  legend.draw(ctx, PAD, PAD + figure.height + GAP);

  downloadBlob(await canvasToPngWithDpi(canvas, DPI), filename);
}
