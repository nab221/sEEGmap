// A4 pages shared by the PNG and PDF exports: the page canvas at print resolution, the
// patient label in its top-right corner, and saving finished pages as one PDF. A PDF page
// is exactly the image the PNG export saves, so the two never differ.

import { jsPDF } from "jspdf";

/** Print resolution of an exported page. */
export const DPI = 300;
/** Device pixels per millimetre at DPI. */
export const MM = DPI / 25.4;
/** Device pixels per CSS pixel at true print size (CSS assumes 96 px per inch). */
export const PRINT_U = DPI / 96;
/** Margin on every side, wide enough for printers that can't print to the edge. */
export const MARGIN = Math.round(10 * MM);

export type Orientation = "landscape" | "portrait";

/** A4 (297 × 210 mm) at DPI, in device px. */
export function a4Size(orientation: Orientation): { w: number; h: number } {
  const long = Math.round(297 * MM); // 3508 px
  const short = Math.round(210 * MM); // 2480 px
  return orientation === "landscape" ? { w: long, h: short } : { w: short, h: long };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Patient label text: 10 pt bold. */
const LABEL_PT = 10;
const LABEL_PX = (LABEL_PT / 72) * DPI;
/** Space kept clear under the label before the page content starts. */
const LABEL_BAND = Math.round(LABEL_PX + 3 * MM);

/**
 * A blank white A4 page with the patient label drawn in its top-right corner. Returns
 * the canvas and the area left for content: inside the margins and, when there is a
 * label, below it, so a figure or legend can never run under the label.
 */
export function newPage(orientation: Orientation, patientLabel: string) {
  const { w, h } = a4Size(orientation);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";

  const label = patientLabel.trim();
  const top = label ? MARGIN + LABEL_BAND : MARGIN;
  if (label) {
    ctx.save();
    ctx.font = `bold ${LABEL_PX}px Helvetica, Arial, sans-serif`;
    ctx.fillStyle = "#182430";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(label, w - MARGIN, MARGIN);
    ctx.restore();
  }
  const area: Box = { x: MARGIN, y: top, w: w - MARGIN * 2, h: h - MARGIN - top };
  return { canvas, ctx, area };
}

/**
 * Encode the canvas as PNG with a pHYs chunk recording `dpi`, so image viewers and
 * print dialogs size it as a full A4 page rather than guessing at 72 or 96 dpi.
 */
export async function canvasToPngWithDpi(canvas: HTMLCanvasElement, dpi: number): Promise<Blob> {
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

/** Save a PNG page as a download, adding ".png" to the name when it's missing. */
export async function downloadPagePng(canvas: HTMLCanvasElement, filename: string) {
  downloadBlob(await canvasToPngWithDpi(canvas, DPI), filename.endsWith(".png") ? filename : `${filename}.png`);
}

/** Save a blob as a download under `filename`. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A jsPDF document in millimetres, A4, with no pages yet added beyond its first. */
export function newPdf(orientation: Orientation): jsPDF {
  return new jsPDF({ orientation, unit: "mm", format: "a4", compress: true });
}

/**
 * Add each page canvas to `doc` as a full A4 page, the first onto the document's
 * existing blank first page. The image fills the page edge to edge; its own margins
 * are already drawn in.
 */
export function addPageImages(doc: jsPDF, pages: { canvas: HTMLCanvasElement; orientation: Orientation }[]) {
  pages.forEach(({ canvas, orientation }, i) => {
    if (i > 0) doc.addPage("a4", orientation);
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, w, h, undefined, "FAST");
  });
}

/** Save the PDF, adding ".pdf" to the name when it's missing. */
export function savePdf(doc: jsPDF, filename: string) {
  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
