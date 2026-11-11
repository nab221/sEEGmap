// Legend image for the Axial view export: one row per placed electrode (ID, name, entry,
// target, contact ranges per tissue state), plus a key to the three dot styles. Saved as a
// separate PNG from the figure.

import type { Electrode, Tissue } from "../../types";
import { electrodeLetter } from "../nomenclature";
import { formatTissueRanges, normalizeAxial } from "../axial";
import { TISSUE_KEY_ORDER, TISSUE_STYLE } from "../axialStyle";
import { LegendTable } from "./legend";
import { canvasToPngWithDpi, downloadBlob } from "./png";

const DPI = 300;
/** Device pixels per CSS pixel at true print size. */
const PRINT_U = DPI / 96;

export interface AxialLegendEntry {
  electrode: Electrode;
  /** Same letter as the Planner legend: position in the whole plan, grids included. */
  letter: string;
  ranges: string;
}

/** Placed depth electrodes in plan order, with their Planner letters and contact ranges. */
export function axialLegendEntries(all: Electrode[]): AxialLegendEntry[] {
  const sorted = [...all].sort((a, b) => a.order - b.order);
  return sorted.flatMap((e, i) =>
    e.type !== "grid" && e.axial
      ? [{ electrode: e, letter: electrodeLetter(i), ranges: formatTissueRanges(normalizeAxial(e.axial).tissue) }]
      : []
  );
}

/** Draw and download the legend PNG. Does nothing when no electrode is placed. */
export async function exportAxialLegendPng(allElectrodes: Electrode[], filename: string): Promise<void> {
  const entries = axialLegendEntries(allElectrodes);
  if (entries.length === 0) return;
  const byId = new Map(entries.map((x) => [x.electrode.id, x]));
  const u = PRINT_U;

  const table = new LegendTable(
    entries.map((x) => x.electrode),
    u,
    {
      letterFor: (e) => byId.get(e.id)!.letter,
      extraColumn: { header: "Contacts", cap: 320, cell: (e) => byId.get(e.id)!.ranges },
    }
  );
  const layout = table.layoutForHeight(Infinity);

  const pad = 16 * u;
  const keyGap = 14 * u;
  const keyH = 16 * u;
  const dotR = 5 * u;
  const font = `${12 * u}px Helvetica, Arial, sans-serif`;

  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const itemW = (t: Tissue) => dotR * 2 + 6 * u + measure.measureText(TISSUE_STYLE[t].label).width;
  const keyW = TISSUE_KEY_ORDER.reduce((w, t) => w + itemW(t), 0) + 18 * u * (TISSUE_KEY_ORDER.length - 1);

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(pad * 2 + Math.max(layout.width, keyW));
  canvas.height = Math.ceil(pad * 2 + layout.height + keyGap + keyH);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  table.draw(ctx, pad, pad, layout);

  // Key to the dot styles, drawn exactly as on the figure.
  const cy = pad + layout.height + keyGap + keyH / 2;
  let x = pad;
  ctx.font = font;
  ctx.textBaseline = "middle";
  for (const t of TISSUE_KEY_ORDER) {
    drawTissueDot(ctx, x + dotR, cy, dotR, t, u);
    ctx.fillStyle = "#182430";
    ctx.fillText(TISSUE_STYLE[t].label, x + dotR * 2 + 6 * u, cy);
    x += itemW(t) + 18 * u;
  }

  downloadBlob(await canvasToPngWithDpi(canvas, DPI), filename);
}

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
  ctx.restore();
}
