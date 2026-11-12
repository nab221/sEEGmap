// Legends for the Electrode view exports: one row per placed electrode (ID, name, entry,
// target, contact ranges per state), plus a key to the four dot styles. Drawn under each
// view's own PNG for that view's electrodes, and saved once more as a combined legend PNG.

import type { AxialViewId, Electrode, Tissue } from "../../types";
import { electrodeLetter } from "../nomenclature";
import { effectiveTissue, formatTissueRanges, normalizeAxial } from "../axial";
import { TISSUE_KEY_ORDER, TISSUE_STYLE } from "../axialStyle";
import { LegendTable, type LegendLayout } from "./legend";
import { canvasToPngWithDpi, downloadBlob } from "./png";

export const DPI = 300;
/** Device pixels per CSS pixel at true print size. */
export const PRINT_U = DPI / 96;

export interface AxialLegendEntry {
  electrode: Electrode;
  /** Same letter as the Planner legend: position in the whole plan, grids included. */
  letter: string;
  ranges: string;
}

/**
 * Placed depth electrodes in plan order, with their Planner letters and contact ranges.
 * With `viewId`, only the electrodes on that view.
 */
export function axialLegendEntries(all: Electrode[], viewId?: AxialViewId): AxialLegendEntry[] {
  const sorted = [...all].sort((a, b) => a.order - b.order);
  return sorted.flatMap((e, i) => {
    const placement = e.type !== "grid" ? normalizeAxial(e.axial) : null;
    if (!placement || (viewId && placement.view !== viewId)) return [];
    return [{ electrode: e, letter: electrodeLetter(i), ranges: formatTissueRanges(effectiveTissue(placement)) }];
  });
}

/** The legend table and dot key for some entries, laid out at print scale `u`. */
export interface LegendParts {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number) => void;
}

export function buildLegendParts(entries: AxialLegendEntry[], u: number): LegendParts {
  const byId = new Map(entries.map((x) => [x.electrode.id, x]));
  const table = new LegendTable(
    entries.map((x) => x.electrode),
    u,
    {
      letterFor: (e) => byId.get(e.id)!.letter,
      // No width cap: a truncated range would hide contacts.
      extraColumn: { header: "Contacts", cap: Infinity, cell: (e) => byId.get(e.id)!.ranges },
    }
  );
  const layout: LegendLayout = table.layoutForHeight(Infinity);
  const keyGap = 14 * u;
  const key = measureTissueKey(u);
  return {
    width: Math.max(layout.width, key.width),
    height: layout.height + keyGap + key.height,
    draw: (ctx, x, y) => {
      table.draw(ctx, x, y, layout);
      drawTissueKey(ctx, x, y + layout.height + keyGap, u);
    },
  };
}

const keyFont = (u: number) => `${12 * u}px Helvetica, Arial, sans-serif`;
const keyDotR = (u: number) => 5 * u;

/** Size of the four-state dot key at print scale `u`. */
export function measureTissueKey(u: number): { width: number; height: number } {
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = keyFont(u);
  const width =
    TISSUE_KEY_ORDER.reduce((w, t) => w + keyItemWidth(measure, t, u), 0) + 18 * u * (TISSUE_KEY_ORDER.length - 1);
  return { width, height: 16 * u };
}

function keyItemWidth(ctx: CanvasRenderingContext2D, t: Tissue, u: number): number {
  return keyDotR(u) * 2 + 6 * u + ctx.measureText(TISSUE_STYLE[t].label).width;
}

/** Draw the four-state dot key with its top-left at (x, y). */
export function drawTissueKey(ctx: CanvasRenderingContext2D, x: number, y: number, u: number): void {
  const r = keyDotR(u);
  const cy = y + 8 * u;
  ctx.save();
  ctx.font = keyFont(u);
  ctx.textBaseline = "middle";
  let cx = x;
  for (const t of TISSUE_KEY_ORDER) {
    drawTissueDot(ctx, cx + r, cy, r, t, u);
    ctx.fillStyle = "#182430";
    ctx.fillText(TISSUE_STYLE[t].label, cx + r * 2 + 6 * u, cy);
    cx += keyItemWidth(ctx, t, u) + 18 * u;
  }
  ctx.restore();
}

/** Draw and download the combined legend PNG. Does nothing when no electrode is placed. */
export async function exportAxialLegendPng(allElectrodes: Electrode[], filename: string): Promise<void> {
  const entries = axialLegendEntries(allElectrodes);
  if (entries.length === 0) return;
  const u = PRINT_U;
  const parts = buildLegendParts(entries, u);
  const pad = 16 * u;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(pad * 2 + parts.width);
  canvas.height = Math.ceil(pad * 2 + parts.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  parts.draw(ctx, pad, pad);
  downloadBlob(await canvasToPngWithDpi(canvas, DPI), filename);
}

/** One dot drawn exactly as on the figure. */
function drawTissueDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: Tissue, u: number) {
  const st = TISSUE_STYLE[t];
  ctx.save();
  ctx.globalAlpha = st.opacity;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (st.fill) {
    ctx.fillStyle = st.fill;
    ctx.fill();
  }
  if (st.stroke) {
    ctx.strokeStyle = st.stroke;
    ctx.lineWidth = 1.2 * u;
    ctx.stroke();
  }
  if (st.cross) {
    const k = r * 0.55;
    ctx.beginPath();
    ctx.moveTo(x - k, y - k);
    ctx.lineTo(x + k, y + k);
    ctx.moveTo(x + k, y - k);
    ctx.lineTo(x - k, y + k);
    ctx.strokeStyle = st.stroke ?? "#8a8a8a";
    ctx.lineWidth = 1 * u;
    ctx.stroke();
  }
  if (st.slash) {
    const k = r * 0.95;
    ctx.beginPath();
    ctx.moveTo(x - k, y + k);
    ctx.lineTo(x + k, y - k);
    ctx.strokeStyle = st.stroke ?? "#222222";
    ctx.lineWidth = 1.3 * u;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  ctx.restore();
}
