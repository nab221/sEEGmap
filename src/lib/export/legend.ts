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
  const sorted = [...electrodes].sort((a, b) => a.order - b.order);
  if (sorted.length === 0) return figureDataUrl;

  const u = scale;
  const pad = 16 * u;
  const gap = 20 * u;
  const rowH = 20 * u;
  const cellPadX = 6 * u;
  const dotR = 4 * u;
  const dotSpace = dotR * 2 + 5 * u;
  const fontSize = 12 * u;
  const fontFamily = "Helvetica, Arial, sans-serif";
  const bodyFont = `${fontSize}px ${fontFamily}`;
  const headFont = `bold ${fontSize}px ${fontFamily}`;

  // The capture includes the empty canvas area around the figure; trim it so the
  // figure sits right next to the legend.
  const figure = trimWhitespace(await loadImage(figureDataUrl), 2 * u);
  const figW = figure.width;
  const figH = figure.height;

  const measure = document.createElement("canvas").getContext("2d")!;
  const textW = (text: string, font: string) => {
    measure.font = font;
    return measure.measureText(text).width;
  };

  const rows = sorted.map((e, i) => ({
    num: String(i + 1),
    name: e.name,
    entry: e.entryName || "--",
    target: e.targetName || "--",
    color: e.color,
  }));

  // Column widths fit the longest cell, capped so a long label truncates instead of
  // pushing the figure off to one side.
  const colWidth = (header: string, cells: string[], cap: number, extra = 0) =>
    Math.min(
      cap,
      Math.max(textW(header, headFont), ...cells.map((c) => textW(c, bodyFont) + extra))
    ) +
    cellPadX * 2;
  const cols = [
    { key: "num" as const, header: "#", w: colWidth("#", rows.map((r) => r.num), 30 * u) },
    { key: "name" as const, header: "Name", w: colWidth("Name", rows.map((r) => r.name), 120 * u, dotSpace) },
    { key: "entry" as const, header: "Entry", w: colWidth("Entry", rows.map((r) => r.entry), 200 * u) },
    { key: "target" as const, header: "Target", w: colWidth("Target", rows.map((r) => r.target), 220 * u) },
  ];
  const tableW = cols.reduce((sum, c) => sum + c.w, 0);

  // Split into as many side-by-side tables as needed to stay within the figure height.
  const maxRows = Math.max(1, Math.floor((figH - rowH) / rowH));
  const tableCount = Math.ceil(rows.length / maxRows);
  const rowsPerTable = Math.ceil(rows.length / tableCount);
  const tableH = rowH * (rowsPerTable + 1);
  const legendW = tableCount * tableW + (tableCount - 1) * gap;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(pad + legendW + gap + figW + pad);
  canvas.height = Math.ceil(pad + Math.max(figH, tableH) + pad);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(figure, pad + legendW + gap, pad, figW, figH);

  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(1, u * 0.6);
  ctx.strokeStyle = "#D5DDE1";

  for (let t = 0; t < tableCount; t++) {
    const x0 = pad + t * (tableW + gap);
    const chunk = rows.slice(t * rowsPerTable, (t + 1) * rowsPerTable);

    // Header row
    ctx.fillStyle = "#DDE7EA";
    ctx.fillRect(x0, pad, tableW, rowH);
    ctx.font = headFont;
    ctx.fillStyle = "#182430";
    let x = x0;
    cols.forEach((c) => {
      ctx.fillText(c.header, x + cellPadX, pad + rowH / 2);
      x += c.w;
    });

    // Body rows
    ctx.font = bodyFont;
    chunk.forEach((r, i) => {
      const y = pad + rowH * (i + 1);
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
    ctx.strokeRect(x0, pad, tableW, h);
    for (let i = 1; i <= chunk.length; i++) {
      line(ctx, x0, pad + rowH * i, x0 + tableW, pad + rowH * i);
    }
    let gx = x0;
    cols.slice(0, -1).forEach((c) => {
      gx += c.w;
      line(ctx, gx, pad, gx, pad + h);
    });
  }

  return canvas.toDataURL("image/png");
}

/**
 * Crop away the near-white border around an image's content, keeping `margin` pixels
 * of it. Returns the image unchanged (as a canvas) when it is entirely blank.
 */
function trimWhitespace(img: HTMLImageElement, margin: number): HTMLCanvasElement {
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
