import type { jsPDF } from "jspdf";
import { renderPlannerPage } from "./png";
import { addPageImages, newPdf, savePdf, type Orientation } from "./page";
import type { Electrode } from "../../types";

interface PdfOptions {
  node: HTMLElement;
  electrodes: Electrode[];
  patientLabel: string;
  planNotes: string;
  filename: string;
  /** Draw the electrode legend beside the figure, exactly as in the PNG. */
  includeLegend?: boolean;
  /** Add the plan notes and per-electrode notes as pages after the figure. */
  includeNotes?: boolean;
}

/**
 * Export the Planner as a PDF. Page 1 is the same A4 landscape page the PNG export
 * saves; with `includeNotes`, the notes follow on further pages.
 */
export async function exportWorkspacePdf({
  node,
  electrodes,
  patientLabel,
  planNotes,
  filename,
  includeLegend = false,
  includeNotes = false,
}: PdfOptions) {
  const page = await renderPlannerPage(node, patientLabel, includeLegend ? electrodes : undefined);
  const doc = newPdf("landscape");
  addPageImages(doc, [{ canvas: page, orientation: "landscape" }]);
  if (includeNotes) addNotesPages(doc, "landscape", patientLabel, planNotes, electrodes);
  savePdf(doc, filename);
}

/** Page margin in mm, matching the image pages. */
const M = 10;
const LINE = 5;

/**
 * Plan notes, then each electrode's notes, as text pages with the patient label in the
 * top-right corner like the image pages.
 */
export function addNotesPages(
  doc: jsPDF,
  orientation: Orientation,
  patientLabel: string,
  planNotes: string,
  electrodes: Electrode[]
) {
  doc.addPage("a4", orientation);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const bottom = pageH - M;
  let y = 0;

  const startPage = () => {
    drawPatientLabel(doc, patientLabel, pageW);
    y = M + 10;
  };
  const ensureRoom = (h: number) => {
    if (y + h > bottom) {
      doc.addPage("a4", orientation);
      startPage();
    }
  };
  startPage();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Notes", M, y);
  y += 10;

  doc.setFontSize(11);
  doc.text("Plan notes", M, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const planLines: string[] = doc.splitTextToSize(planNotes.trim() || "(none)", pageW - M * 2);
  planLines.forEach((line) => {
    ensureRoom(LINE);
    doc.text(line, M, y);
    y += LINE;
  });
  y += 6;

  const withNotes = [...electrodes].sort((a, b) => a.order - b.order).filter((e) => e.notes.trim());
  if (withNotes.length === 0) return;

  ensureRoom(12);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Per-electrode notes", M, y);
  y += 6;
  doc.setFontSize(10);
  const nameW = 28;
  withNotes.forEach((e) => {
    const lines: string[] = doc.splitTextToSize(e.notes.trim(), pageW - M * 2 - nameW);
    lines.forEach((line, i) => {
      ensureRoom(LINE);
      if (i === 0 || y === M + 10) {
        doc.setFont("helvetica", "bold");
        doc.text(e.name, M, y, { maxWidth: nameW - 2 });
      }
      doc.setFont("helvetica", "normal");
      doc.text(line, M + nameW, y);
      y += LINE;
    });
    y += 2;
  });
}

function drawPatientLabel(doc: jsPDF, patientLabel: string, pageW: number) {
  const label = patientLabel.trim();
  if (!label) return;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(24, 36, 48);
  doc.text(label, pageW - M, M, { align: "right", baseline: "top" });
  doc.setTextColor(0);
}
