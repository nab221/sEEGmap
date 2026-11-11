import type { Electrode } from "../../types";

/**
 * Compose a captured figure (a PNG data URL) with an electrode legend table drawn to
 * its left, at the same resolution, and return the combined image as a PNG data URL.
 *
 * `scale` is the capture's pixel ratio: every size below is in CSS pixels and is
 * multiplied by it, so the table text stays as sharp as the figure. Rows that don't
 * fit beside the figure flow into further table columns rather than shrinking the
 * text. With no electrodes, the figure is returned unchanged.
 */
export async function composeFigureWithLegend(
  figureDataUrl: string,
  electrodes: Electrode[],
  scale: number
): Promise<string> {
  if (electrodes.length === 0) return figureDataUrl;

  const u = scale;
  const pad = 16 * u;
  const gap = 20 * u;

  // The capture includes the empty canvas area around the figure; trim it so the
  // figure sits right next to the legend.
  const figure = trimWhitespace(await loadImage(figureDataUrl), 2 * u);
  const figW = figure.width;
  const figH = figure.height;

  const legend = new LegendTable(electrodes, u);
  // Split into as many side-by-side tables as needed to stay within the figure height.
  const layout = legend.layoutForHeight(figH);

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(pad + layout.width + gap + figW + pad);
  canvas.height = Math.ceil(pad + Math.max(figH, layout.height) + pad);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(figure, pad + layout.width + gap, pad, figW, figH);
  legend.draw(ctx, pad, pad, layout);

  return canvas.toDataURL("image/png");
}

/** How a legend's rows are split into side-by-side tables, and the space that takes. */
export interface LegendLayout {
  tableCount: number;
  rowsPerTable: number;
  width: number;
  height: number;
}

/**
 * The electrode legend table: name, entry and target per electrode, drawn on a 2D
 * canvas. `u` is the number of device pixels per CSS pixel; every size is a CSS-pixel
 * size multiplied by it. Long legends flow into further tables placed side by side.
 */
export class LegendTable {
  readonly rowH: number;
  readonly gap: number;
  private readonly u: number;
  private readonly cellPadX: number;
  private readonly dotR: number;
  private readonly dotSpace: number;
  private readonly bodyFont: string;
  private readonly headFont: string;
  private readonly rows: { num: string; name: string; entry: string; target: string; color: string }[];
  private readonly cols: { key: "num" | "name" | "entry" | "target"; header: string; w: number }[];
  readonly tableW: number;

  constructor(electrodes: Electrode[], u: number) {
    this.u = u;
    this.rowH = 20 * u;
    this.gap = 20 * u;
    this.cellPadX = 6 * u;
    this.dotR = 4 * u;
    this.dotSpace = this.dotR * 2 + 5 * u;
    const fontSize = 12 * u;
    const fontFamily = "Helvetica, Arial, sans-serif";
    this.bodyFont = `${fontSize}px ${fontFamily}`;
    this.headFont = `bold ${fontSize}px ${fontFamily}`;

    const sorted = [...electrodes].sort((a, b) => a.order - b.order);
    this.rows = sorted.map((e, i) => ({
      num: String(i + 1),
      name: e.name,
      entry: e.entryName || "--",
      target: e.targetName || "--",
      color: e.color,
    }));

    const measure = document.createElement("canvas").getContext("2d")!;
    const textW = (text: string, font: string) => {
      measure.font = font;
      return measure.measureText(text).width;
    };
    // Column widths fit the longest cell, capped so a long label truncates instead of
    // pushing the figure off to one side.
    const colWidth = (header: string, cells: string[], cap: number, extra = 0) =>
      Math.min(
        cap,
        Math.max(textW(header, this.headFont), ...cells.map((c) => textW(c, this.bodyFont) + extra))
      ) +
      this.cellPadX * 2;
    const rows = this.rows;
    this.cols = [
      { key: "num", header: "#", w: colWidth("#", rows.map((r) => r.num), 30 * u) },
      { key: "name", header: "Name", w: colWidth("Name", rows.map((r) => r.name), 120 * u, this.dotSpace) },
      { key: "entry", header: "Entry", w: colWidth("Entry", rows.map((r) => r.entry), 200 * u) },
      { key: "target", header: "Target", w: colWidth("Target", rows.map((r) => r.target), 220 * u) },
    ];
    this.tableW = this.cols.reduce((sum, c) => sum + c.w, 0);
  }

  get rowCount() {
    return this.rows.length;
  }

  /** Use as few tables as possible while each stays within `maxH` pixels tall. */
  layoutForHeight(maxH: number): LegendLayout {
    const maxRows = Math.max(1, Math.floor((maxH - this.rowH) / this.rowH));
    return this.layoutWithTables(Math.ceil(this.rows.length / maxRows));
  }

  /** Use as many tables as fit side by side within `maxW` pixels, to keep it short. */
  layoutForWidth(maxW: number): LegendLayout {
    const fit = Math.max(1, Math.floor((maxW + this.gap) / (this.tableW + this.gap)));
    return this.layoutWithTables(Math.min(fit, this.rows.length));
  }

  private layoutWithTables(count: number): LegendLayout {
    const tableCount = Math.max(1, count);
    const rowsPerTable = Math.ceil(this.rows.length / tableCount);
    // Re-derive the count so no table is left empty (e.g. 10 rows in 4 tables of 3).
    const used = Math.max(1, Math.ceil(this.rows.length / rowsPerTable));
    return {
      tableCount: used,
      rowsPerTable,
      width: used * this.tableW + (used - 1) * this.gap,
      height: this.rowH * (rowsPerTable + 1),
    };
  }

  /** Draw the tables with their top-left corner at (left, top). */
  draw(ctx: CanvasRenderingContext2D, left: number, top: number, layout: LegendLayout) {
    const { rowH, cellPadX, dotR, dotSpace, cols, tableW } = this;
    ctx.save();
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(1, this.u * 0.6);
    ctx.strokeStyle = "#D5DDE1";

    for (let t = 0; t < layout.tableCount; t++) {
      const x0 = left + t * (tableW + this.gap);
      const chunk = this.rows.slice(t * layout.rowsPerTable, (t + 1) * layout.rowsPerTable);

      // Header row
      ctx.fillStyle = "#DDE7EA";
      ctx.fillRect(x0, top, tableW, rowH);
      ctx.font = this.headFont;
      ctx.fillStyle = "#182430";
      let x = x0;
      cols.forEach((c) => {
        ctx.fillText(c.header, x + cellPadX, top + rowH / 2);
        x += c.w;
      });

      // Body rows
      ctx.font = this.bodyFont;
      chunk.forEach((r, i) => {
        const y = top + rowH * (i + 1);
        ctx.fillStyle = i % 2 === 0 ? "#F7F9FA" : "#EAF0F2";
        ctx.fillRect(x0, y, tableW, rowH);
        let cx = x0;
        cols.forEach((c) => {
          let tx = cx + cellPadX;
          if (c.key === "name") {
            ctx.fillStyle = r.color;
            ctx.beginPath();
            ctx.arc(tx + dotR, y + rowH / 2, dotR, 0, Math.PI * 2);
            ctx.fill();
            tx += dotSpace;
          }
          ctx.fillStyle = "#182430";
          const room = cx + c.w - cellPadX - tx;
          ctx.fillText(fitText(ctx, r[c.key], room), tx, y + rowH / 2);
          cx += c.w;
        });
      });

      // Grid lines
      const h = rowH * (chunk.length + 1);
      ctx.strokeRect(x0, top, tableW, h);
      for (let i = 1; i <= chunk.length; i++) {
        line(ctx, x0, top + rowH * i, x0 + tableW, top + rowH * i);
      }
      let gx = x0;
      cols.slice(0, -1).forEach((c) => {
        gx += c.w;
        line(ctx, gx, top, gx, top + h);
      });
    }
    ctx.restore();
  }
}

/**
 * Crop away the near-white border around an image's content, keeping `margin` pixels
 * of it. Returns the image unchanged (as a canvas) when it is entirely blank.
 */
export function trimWhitespace(img: HTMLImageElement, margin: number): HTMLCanvasElement {
  const w = img.width;
  const h = img.height;
  const src = document.createElement("canvas");
  src.width = w;
  src.height = h;
  const sctx = src.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(img, 0, 0);
  const { data } = sctx.getImageData(0, 0, w, h);

  // A pixel counts as content when any channel is visibly darker than white.
  const isContent = (i: number) => data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245;
  let top = h;
  let bottom = -1;
  let left = w;
  let right = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    let first = -1;
    for (let x = 0; x < w; x++) {
      if (isContent(row + x * 4)) {
        first = x;
        break;
      }
    }
    if (first < 0) continue;
    let last = first;
    for (let x = w - 1; x > first; x--) {
      if (isContent(row + x * 4)) {
        last = x;
        break;
      }
    }
    if (y < top) top = y;
    bottom = y;
    if (first < left) left = first;
    if (last > right) right = last;
  }
  if (bottom < 0) return src;

  const x0 = Math.max(0, Math.floor(left - margin));
  const y0 = Math.max(0, Math.floor(top - margin));
  const x1 = Math.min(w, Math.ceil(right + 1 + margin));
  const y1 = Math.min(h, Math.ceil(bottom + 1 + margin));
  const out = document.createElement("canvas");
  out.width = x1 - x0;
  out.height = y1 - y0;
  out.getContext("2d")!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Truncate `text` with an ellipsis so it fits in `maxW` at the context's current font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
