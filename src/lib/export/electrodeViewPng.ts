// One Electrode view as an A4 portrait page for a clinical report: the outline with its
// electrodes, that view's legend and dot key underneath, and the patient label in the
// top-right corner. Editing handles are left out. Saved as one PNG per view, or every
// view as one page each of a single PDF; a PDF page is exactly the PNG.

import { captureNode } from "./capture";
import { loadImage, trimWhitespace } from "./legend";
import { buildLegendParts, type AxialLegendEntry } from "./axialLegend";
import { MM, PRINT_U, addPageImages, downloadPagePng, newPage, newPdf, savePdf } from "./page";

/** Space between the figure and its legend. */
const GAP = Math.round(8 * MM);
/** Largest share of the page height the legend may take before its text is shrunk. */
const MAX_LEGEND_SHARE = 0.5;

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

export interface ElectrodeViewPage {
  node: HTMLElement;
  entries: AxialLegendEntry[];
}

/** Draw one view and its legend on an A4 portrait page. */
export async function renderElectrodeViewPage(
  { node, entries }: ElectrodeViewPage,
  patientLabel: string
): Promise<HTMLCanvasElement> {
  const { canvas, ctx, area } = newPage("portrait", patientLabel);

  // The legend keeps print size unless it is wider than the page or would take more
  // than MAX_LEGEND_SHARE of its height; then its text is drawn smaller to fit.
  const full = buildLegendParts(entries, PRINT_U);
  const shrink = Math.min(1, area.w / full.width, (area.h * MAX_LEGEND_SHARE) / full.height);
  const legend = shrink < 1 ? buildLegendParts(entries, PRINT_U * shrink) : full;

  // Capture at the width the figure can take on the page, so it isn't blurred by upscaling.
  const ratio = area.w / Math.max(1, node.clientWidth);
  const figure = trimWhitespace(await loadImage(await captureWithoutHandles(node, ratio)), 8 * ratio);
  const figBoxH = Math.max(1, area.h - legend.height - GAP);
  const s = Math.min(area.w / figure.width, figBoxH / figure.height);
  const figW = figure.width * s;
  const figH = figure.height * s;
  ctx.drawImage(figure, area.x + (area.w - figW) / 2, area.y, figW, figH);
  legend.draw(ctx, area.x, area.y + figH + GAP);
  return canvas;
}

/** Save one view as an A4 portrait PNG at 300 dpi. */
export async function exportElectrodeViewPng(
  view: ElectrodeViewPage,
  patientLabel: string,
  filename: string
): Promise<void> {
  await downloadPagePng(await renderElectrodeViewPage(view, patientLabel), filename);
}

/** Save every view as one page each of a single A4 portrait PDF. */
export async function exportElectrodeViewPdf(
  views: ElectrodeViewPage[],
  patientLabel: string,
  filename: string
): Promise<void> {
  if (views.length === 0) return;
  const doc = newPdf("portrait");
  // Rendered one at a time: each page canvas is large, so only one is held at once.
  for (let i = 0; i < views.length; i++) {
    const canvas = await renderElectrodeViewPage(views[i], patientLabel);
    if (i > 0) doc.addPage("a4", "portrait");
    addPageImages(doc, [{ canvas, orientation: "portrait" }]);
  }
  savePdf(doc, filename);
}
