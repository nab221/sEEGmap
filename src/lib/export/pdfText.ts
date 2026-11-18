// Text for jsPDF that may mix Helvetica with symbols (arrows, ≥, Greek letters, check marks)
// drawn from the PDF's built-in Symbol and ZapfDingbats fonts. Lines are split into runs,
// one per font; widths for the symbol fonts come from our own table because jsPDF's
// metrics for them are wrong.

import type { jsPDF } from "jspdf";
import { PDF_SYMBOLS } from "../mdtNote";

interface Run {
  /** null = the current Helvetica style. */
  font: "symbol" | "zapfdingbats" | null;
  text: string;
}

function runs(s: string): Run[] {
  const out: Run[] = [];
  for (const ch of s) {
    const sym = PDF_SYMBOLS[ch];
    const font = sym ? sym.font : null;
    const piece = sym ? sym.code : ch;
    const last = out[out.length - 1];
    if (last && last.font === font) last.text += piece;
    else out.push({ font, text: piece });
  }
  return out;
}

/** Width of a symbol-font run in the document's units, at the current font size. */
function symbolWidth(doc: jsPDF, chars: string): number {
  let em = 0;
  for (const ch of chars) em += PDF_SYMBOLS[ch]?.w ?? 600;
  return (em / 1000) * (doc.getFontSize() / doc.internal.scaleFactor);
}

/** Width of `s` in the current Helvetica font and size, counting symbols at their true widths. */
export function measure(doc: jsPDF, s: string): number {
  let w = 0;
  let plain = "";
  for (const ch of s) {
    if (PDF_SYMBOLS[ch]) w += symbolWidth(doc, ch);
    else plain += ch;
  }
  return w + (plain ? doc.getTextWidth(plain) : 0);
}

/**
 * Stand-in used while wrapping: as wide as the widest common symbol, so lines with symbols
 * never come out too long. Each stand-in is put back in order afterwards (wrapping only
 * drops spaces), and a real "‰" in the text is handled the same way.
 */
const STAND_IN = "‰";

/** Wrap `s` to `width` in the current font, like `doc.splitTextToSize`, symbols included. */
export function wrapText(doc: jsPDF, s: string, width: number): string[] {
  const originals: string[] = [];
  let masked = "";
  for (const ch of s) {
    if (PDF_SYMBOLS[ch] || ch === STAND_IN) {
      originals.push(ch);
      masked += STAND_IN;
    } else {
      masked += ch;
    }
  }
  const lines: string[] = doc.splitTextToSize(masked, width);
  if (!originals.length) return lines;
  let k = 0;
  return lines.map((line) => Array.from(line, (ch) => (ch === STAND_IN ? originals[k++] ?? ch : ch)).join(""));
}

/**
 * Draw `s` with its top at `y`, in the current Helvetica font, switching to Symbol or
 * ZapfDingbats for the characters only they have. `align: "right"` ends the text at `x`.
 */
export function drawText(doc: jsPDF, s: string, x: number, y: number, opts: { charSpace?: number; align?: "left" | "right" } = {}) {
  const parts = runs(s);
  const charSpace = opts.charSpace ?? 0;
  if (parts.length === 1 && parts[0].font === null) {
    doc.text(s, x, y, { baseline: "top", charSpace, align: opts.align ?? "left" });
    return;
  }
  const { fontName, fontStyle } = doc.getFont();
  const spacing = (t: string) => charSpace * Array.from(t).length;
  let cx = opts.align === "right" ? x - measure(doc, s) - spacing(s) : x;
  // Symbol runs are measured from the original characters, so walk the source alongside.
  let i = 0;
  const source = Array.from(s);
  for (const part of parts) {
    const n = Array.from(part.text).length;
    const original = source.slice(i, i + n).join("");
    i += n;
    if (part.font) {
      doc.setFont(part.font, "normal");
      doc.text(part.text, cx, y, { baseline: "top" });
      cx += symbolWidth(doc, original) + spacing(original);
      doc.setFont(fontName, fontStyle);
    } else {
      doc.text(part.text, cx, y, { baseline: "top", charSpace });
      cx += doc.getTextWidth(part.text) + spacing(part.text);
    }
  }
}
