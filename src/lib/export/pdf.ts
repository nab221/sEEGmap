import type { jsPDF } from "jspdf";
import { renderPlannerPage } from "./png";
import { addPageImages, newPdf, savePdf } from "./page";
import { drawText, measure, wrapText } from "./pdfText";
import {
  DEFAULT_MEETING,
  filledSeizures,
  formatMdtDate,
  isMdtEmpty,
  parseNoteText,
  pdfSafe,
  seizureTitle,
  type NoteBlock,
} from "../mdtNote";
import type { Electrode, MdtNote } from "../../types";

interface PdfOptions {
  node: HTMLElement;
  electrodes: Electrode[];
  patientLabel: string;
  /** The MDT discussion text. */
  planNotes: string;
  mdt: MdtNote;
  filename: string;
  /** Draw the electrode legend beside the figure, exactly as in the PNG. */
  includeLegend?: boolean;
  /** Start the PDF with the MDT note page(s), before the figure. */
  includeNotes?: boolean;
}

/**
 * Export the Planner as a PDF. With `includeNotes`, the MDT note comes first on A4
 * portrait page(s) of selectable text; the figure follows on its own A4 landscape page,
 * the same page the PNG export saves.
 */
export async function exportWorkspacePdf({
  node,
  electrodes,
  patientLabel,
  planNotes,
  mdt,
  filename,
  includeLegend = false,
  includeNotes = false,
}: PdfOptions) {
  const page = await renderPlannerPage(node, patientLabel, includeLegend ? electrodes : undefined);
  const withNote = includeNotes && hasNoteContent(mdt, planNotes, electrodes);
  const doc = newPdf(withNote ? "portrait" : "landscape");
  if (withNote) {
    writeMdtNote(doc, { patientLabel, mdt, discussion: planNotes, electrodes });
    addPageImages(doc, [{ canvas: page, orientation: "landscape" }], { onNewPage: true });
    addPageNumbers(doc, doc.getNumberOfPages() - 1);
  } else {
    addPageImages(doc, [{ canvas: page, orientation: "landscape" }]);
  }
  savePdf(doc, filename);
}

/** Whether there is anything to put on an MDT note page. */
export function hasNoteContent(mdt: MdtNote, discussion: string, electrodes: Electrode[]): boolean {
  return !isMdtEmpty(mdt, discussion) || electrodes.some((e) => e.notes.trim());
}

// ---- Layout (millimetres) ----

/** Patient label sits where it does on the image pages. */
const LABEL_M = 10;
/** Text margins: wider than the image pages', for a comfortable reading measure. */
const SIDE = 20;
const TOP = 22;
const BOTTOM = 20;
const BODY_PT = 10;
/** Line pitch for 10 pt text. */
const LINE = 4.9;
const PARA_GAP = 2.4;

const INK: RGB = [24, 36, 48];
const MUTED: RGB = [96, 108, 120];
const ACCENT: RGB = [31, 95, 139];
const TINT: RGB = [236, 243, 249];
const RULE: RGB = [208, 216, 224];

type RGB = [number, number, number];

/** One laid-out line (or spacer) of the note: its height and how to draw it at (x, y-top). */
interface Line {
  h: number;
  draw?: (x: number, y: number) => void;
  /** Don't let a page break separate this line from the next (headings). */
  keepWithNext?: boolean;
}

interface NoteContent {
  patientLabel: string;
  mdt: MdtNote;
  discussion: string;
  electrodes: Electrode[];
}

/**
 * Write the MDT note onto `doc`, starting on its current (first, portrait) page and adding
 * portrait pages as needed: meeting name and date, who was present, each seizure type
 * with its frequency, previous investigations, the discussion text, the outcome in a
 * shaded box, and the per-electrode notes.
 */
export function writeMdtNote(doc: jsPDF, { patientLabel, mdt, discussion, electrodes }: NoteContent) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const width = pageW - SIDE * 2;
  const bottom = pageH - BOTTOM;
  const flow = { y: TOP };

  const newPage = () => {
    doc.addPage("a4", "portrait");
    drawPatientLabel(doc, patientLabel, pageW);
    flow.y = TOP;
  };
  drawPatientLabel(doc, patientLabel, pageW);

  /** Draw lines from the current position, breaking pages as needed. */
  const place = (lines: Line[]) => {
    lines.forEach((line, i) => {
      const next = lines[i + 1];
      const need = line.h + (line.keepWithNext && next ? next.h : 0);
      if (flow.y + need > bottom && flow.y > TOP) {
        newPage();
        if (!line.draw) return; // no spacer at the top of a page
      }
      line.draw?.(SIDE, flow.y);
      flow.y += line.h;
    });
  };

  // Title block
  const title = pdfSafe(mdt.meeting.trim() || DEFAULT_MEETING);
  const date = formatMdtDate(mdt.date);
  setFont(doc, "bold", 16, INK);
  const titleLines: string[] = wrapText(doc, title, width);
  place(titleLines.map((t) => ({ h: 7, draw: (x, y) => text(doc, t, x, y, "bold", 16, INK) })));
  if (date) place([{ h: 6, draw: (x, y) => text(doc, pdfSafe(date), x, y + 0.6, "normal", 11, MUTED) }]);
  place([{ h: 3 }, { h: 5, draw: (x, y) => rule(doc, x, y, width, ACCENT, 0.6) }]);

  if (mdt.attendees.trim()) {
    place(labelledLines(doc, "Present", pdfSafe(mdt.attendees.trim().replace(/\s*\n\s*/g, ", ")), width));
    place([{ h: 3 }]);
  }

  // Seizure semiology and frequency: one entry per seizure type.
  const seizures = filledSeizures(mdt.seizures);
  if (seizures.length) {
    place(sectionHeading(doc, "Seizure semiology and frequency", width));
    seizures.forEach((sz, i) => {
      if (i > 0) place([{ h: 2.6 }]);
      place(seizureLines(doc, pdfSafe(seizureTitle(sz, i)), pdfSafe(sz.frequency.trim()), width));
      const desc = parseNoteText(pdfSafe(sz.description));
      place(shift(blockLines(doc, desc, width - SEIZURE_INDENT), SEIZURE_INDENT));
    });
    place([{ h: 5 }]);
  }

  // Previous investigations, then the discussion
  const sections: [string, string][] = [
    ["Previous investigations", mdt.investigations],
    ["Discussion", discussion],
  ];
  for (const [heading, body] of sections) {
    const blocks = parseNoteText(pdfSafe(body));
    if (!blocks.length) continue;
    place(sectionHeading(doc, heading, width));
    place(blockLines(doc, blocks, width));
    place([{ h: 5 }]);
  }

  // Outcome, in a shaded box with an accent bar; split across pages if it must be.
  const outcome = parseNoteText(pdfSafe(mdt.outcome));
  if (outcome.length) {
    const padX = 4;
    const padY = 3.2;
    const inner = width - padX * 2 - 1.5;
    const lines: Line[] = [
      { h: 6.5, draw: (x, y) => text(doc, "OUTCOME / DECISION", x, y, "bold", 9, ACCENT, 0.4) },
      ...blockLines(doc, outcome, inner),
    ];
    let i = 0;
    while (i < lines.length) {
      // Keep the box heading with at least two lines of text.
      const minNeed = padY * 2 + lines.slice(i, i + 3).reduce((h, l) => h + l.h, 0);
      if (flow.y + minNeed > bottom && flow.y > TOP) newPage();
      let j = i;
      let h = padY * 2;
      while (j < lines.length && flow.y + h + lines[j].h <= bottom) h += lines[j++].h;
      if (j === i) h += lines[j++].h; // a single line taller than a page: draw it anyway
      const top = flow.y;
      doc.setFillColor(...TINT);
      doc.rect(SIDE, top, width, h, "F");
      doc.setFillColor(...ACCENT);
      doc.rect(SIDE, top, 1.5, h, "F");
      let y = top + padY;
      for (const line of lines.slice(i, j)) {
        line.draw?.(SIDE + 1.5 + padX, y);
        y += line.h;
      }
      flow.y = top + h;
      i = j;
      if (i < lines.length) newPage();
    }
    place([{ h: 6 }]);
  }

  // Per-electrode notes, as a two-column table.
  const withNotes = [...electrodes].sort((a, b) => a.order - b.order).filter((e) => e.notes.trim());
  if (withNotes.length) {
    place(sectionHeading(doc, "Electrode notes", width));
    const nameW = 30;
    withNotes.forEach((e, idx) => {
      setFont(doc, "normal", BODY_PT, INK);
      const noteLines: string[] = wrapText(doc, pdfSafe(e.notes.trim()), width - nameW);
      const rows: Line[] = noteLines.map((t, k) => ({
        h: LINE,
        draw: (x, y) => {
          if (k === 0) text(doc, pdfSafe(e.name), x, y, "bold", BODY_PT, INK);
          text(doc, t, x + nameW, y, "normal", BODY_PT, INK);
        },
      }));
      if (idx < withNotes.length - 1) rows.push({ h: 2.6, draw: (x, y) => rule(doc, x, y + 0.9, width, RULE, 0.2) });
      place(rows);
    });
  }
}

/** Number the first `count` pages "Page n of N", N counting every page of the PDF. */
function addPageNumbers(doc: jsPDF, count: number) {
  const total = doc.getNumberOfPages();
  for (let n = 1; n <= count; n++) {
    doc.setPage(n);
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    text(doc, `Page ${n} of ${total}`, w - SIDE, h - 12, "normal", 8, MUTED, 0, "right");
  }
}

/** Seizure descriptions sit this far in from their title. */
const SEIZURE_INDENT = 5;

/**
 * A seizure's title in bold, with its frequency at the right-hand end of the same line
 * when both fit, or on the next line (indented) when they don't.
 */
function seizureLines(doc: jsPDF, title: string, frequency: string, width: number): Line[] {
  const TITLE_PT = 10.5;
  setFont(doc, "bold", TITLE_PT, INK);
  const titleLines: string[] = wrapText(doc, title, width);
  const freq = frequency ? `Frequency: ${frequency}` : "";
  setFont(doc, "bold", BODY_PT, ACCENT);
  const freqW = freq ? measure(doc, freq) : 0;
  setFont(doc, "bold", TITLE_PT, INK);
  const lastW = measure(doc, titleLines[titleLines.length - 1]);
  const sameLine = !!freq && lastW + 8 + freqW <= width;

  const out: Line[] = titleLines.map((t, k) => ({
    h: 5.4,
    keepWithNext: true,
    draw: (x: number, y: number) => {
      text(doc, t, x, y, "bold", TITLE_PT, INK);
      if (sameLine && k === titleLines.length - 1) text(doc, freq, x + width, y + 0.4, "bold", BODY_PT, ACCENT, 0, "right");
    },
  }));
  if (freq && !sameLine) {
    setFont(doc, "bold", BODY_PT, ACCENT);
    const lines: string[] = wrapText(doc, freq, width - SEIZURE_INDENT);
    lines.forEach((t, k) =>
      out.push({
        h: LINE,
        keepWithNext: k === lines.length - 1,
        draw: (x, y) => text(doc, t, x + SEIZURE_INDENT, y, "bold", BODY_PT, ACCENT),
      })
    );
  }
  return out;
}

/** The same lines drawn `dx` mm further right. */
function shift(lines: Line[], dx: number): Line[] {
  return lines.map((l) => ({ ...l, draw: l.draw && ((x: number, y: number) => l.draw!(x + dx, y)) }));
}

function sectionHeading(doc: jsPDF, label: string, width: number): Line[] {
  return [
    {
      h: 7,
      keepWithNext: true,
      draw: (x, y) => {
        text(doc, label.toUpperCase(), x, y, "bold", 9, ACCENT, 0.4);
        rule(doc, x, y + 4.6, width, RULE, 0.25);
      },
    },
  ];
}

/** "Label: text" with the label in bold and the text wrapping under it at full width. */
function labelledLines(doc: jsPDF, label: string, body: string, width: number, indent = 0): Line[] {
  setFont(doc, "bold", BODY_PT, INK);
  const head = `${label}: `;
  const headW = measure(doc, head);
  setFont(doc, "normal", BODY_PT, INK);
  const words = body.split(/\s+/).filter(Boolean);
  let first = "";
  let k = 0;
  while (k < words.length) {
    const candidate = first ? `${first} ${words[k]}` : words[k];
    if (measure(doc, candidate) > width - indent - headW && first) break;
    first = candidate;
    k++;
  }
  const rest: string[] = k < words.length ? wrapText(doc, words.slice(k).join(" "), width - indent) : [];
  return [
    {
      h: LINE,
      draw: (x, y) => {
        text(doc, head, x + indent, y, "bold", BODY_PT, INK);
        text(doc, first, x + indent + headW, y, "normal", BODY_PT, INK);
      },
    },
    ...rest.map((t) => ({ h: LINE, draw: (x: number, y: number) => text(doc, t, x + indent, y, "normal", BODY_PT, INK) })),
  ];
}

/** Lay out parsed note blocks to `width`. */
function blockLines(doc: jsPDF, blocks: NoteBlock[], width: number): Line[] {
  const out: Line[] = [];
  blocks.forEach((b, i) => {
    const prev = blocks[i - 1];
    switch (b.kind) {
      case "gap":
        out.push({ h: PARA_GAP });
        break;
      case "heading": {
        if (prev && prev.kind !== "gap") out.push({ h: 1.6 });
        setFont(doc, "bold", 10.5, INK);
        const lines: string[] = wrapText(doc, b.text, width);
        lines.forEach((t, k) =>
          out.push({ h: 5.4, keepWithNext: k === lines.length - 1, draw: (x, y) => text(doc, t, x, y, "bold", 10.5, INK) })
        );
        break;
      }
      case "bullet":
      case "numbered": {
        const indent = 4 + b.level * 6;
        const marker = b.kind === "bullet" ? (b.level ? "-" : "•") : b.marker;
        setFont(doc, "normal", BODY_PT, INK);
        const hang = Math.max(4.5, measure(doc, marker) + 2);
        const lines: string[] = wrapText(doc, b.text, width - indent - hang);
        lines.forEach((t, k) =>
          out.push({
            h: LINE,
            draw: (x, y) => {
              if (k === 0) text(doc, marker, x + indent, y, "normal", BODY_PT, b.kind === "bullet" ? ACCENT : INK);
              text(doc, t, x + indent + hang, y, "normal", BODY_PT, INK);
            },
          })
        );
        break;
      }
      case "para": {
        if (b.label) {
          out.push(...labelledLines(doc, b.label, b.text, width));
        } else {
          setFont(doc, "normal", BODY_PT, INK);
          const lines: string[] = wrapText(doc, b.text, width);
          lines.forEach((t) => out.push({ h: LINE, draw: (x, y) => text(doc, t, x, y, "normal", BODY_PT, INK) }));
        }
        break;
      }
    }
  });
  return out;
}

function setFont(doc: jsPDF, style: "normal" | "bold", size: number, color: RGB) {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

function text(
  doc: jsPDF,
  s: string,
  x: number,
  y: number,
  style: "normal" | "bold",
  size: number,
  color: RGB,
  charSpace = 0,
  align: "left" | "right" = "left"
) {
  setFont(doc, style, size, color);
  drawText(doc, s, x, y, { charSpace, align });
}

function rule(doc: jsPDF, x: number, y: number, w: number, color: RGB, weight: number) {
  doc.setDrawColor(...color);
  doc.setLineWidth(weight);
  doc.line(x, y, x + w, y);
}

function drawPatientLabel(doc: jsPDF, patientLabel: string, pageW: number) {
  const label = pdfSafe(patientLabel.trim());
  if (!label) return;
  text(doc, label, pageW - LABEL_M, LABEL_M, "bold", 10, INK, 0, "right");
}
