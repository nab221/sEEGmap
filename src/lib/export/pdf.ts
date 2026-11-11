import { jsPDF } from "jspdf";
import { captureNode, getImageSize } from "./capture";
import { composeFigureWithLegend } from "./legend";
import { electrodeLetter } from "../nomenclature";
import type { Electrode } from "../../types";

interface PdfOptions {
  node: HTMLElement;
  electrodes: Electrode[];
  patientLabel: string;
  planNotes: string;
  institution?: string;
  filename: string;
  /** Draw the electrode legend beside the figure on the overview page. */
  includeLegend?: boolean;
}

export async function exportWorkspacePdf({
  node,
  electrodes,
  patientLabel,
  planNotes,
  institution,
  filename,
  includeLegend = false,
}: PdfOptions) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;

  // ---------- Page 1: Overview ----------
  drawHeader(doc, "sEEGmap -- Overview", patientLabel, institution, pageW, margin);
  // Captured at 3x (as for PNG) when the legend shares the page, since the combined
  // image is scaled down further to fit.
  const captureScale = includeLegend ? 3 : 2;
  const figureUrl = await captureNode(node, captureScale);
  const dataUrl = includeLegend
    ? await composeFigureWithLegend(figureUrl, electrodes, captureScale)
    : figureUrl;
  const { width: iw, height: ih } = await getImageSize(dataUrl);
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2 - 40;
  const scale = Math.min(availW / iw, availH / ih);
  const drawW = iw * scale;
  const drawH = ih * scale;
  doc.addImage(dataUrl, "PNG", (pageW - drawW) / 2, margin + 40, drawW, drawH);

  // ---------- Page 2: Electrode Table ----------
  doc.addPage();
  drawHeader(doc, "sEEGmap -- Electrode Table", patientLabel, institution, pageW, margin);
  const sorted = [...electrodes].sort((a, b) => a.order - b.order);
  const cols = [
    { key: "order", label: "ID", w: 26 },
    { key: "name", label: "Name", w: 70 },
    { key: "entry", label: "Entry", w: 220 },
    { key: "target", label: "Target", w: 220 },
    { key: "notes", label: "Notes", w: pageW - margin * 2 - (26 + 70 + 220 + 220) },
  ];
  let y = margin + 56;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  let x = margin;
  cols.forEach((c) => {
    doc.text(c.label, x, y);
    x += c.w;
  });
  y += 6;
  doc.setDrawColor(200);
  doc.line(margin, y, pageW - margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  sorted.forEach((e, i) => {
    if (y > pageH - margin) {
      doc.addPage();
      y = margin + 20;
    }
    x = margin;
    const row = [
      electrodeLetter(i),
      e.name,
      e.entryName || "--",
      e.targetName || "--",
      truncate(e.notes || "--", 60),
    ];
    row.forEach((val, ci) => {
      doc.text(val, x, y, { maxWidth: cols[ci].w - 6 });
      x += cols[ci].w;
    });
    y += 18;
  });

  // ---------- Page 3: Notes ----------
  doc.addPage();
  drawHeader(doc, "sEEGmap -- Notes", patientLabel, institution, pageW, margin);
  y = margin + 60;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Plan notes", margin, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const planLines = doc.splitTextToSize(planNotes || "(none)", pageW - margin * 2);
  doc.text(planLines, margin, y);
  y += planLines.length * 13 + 20;

  const withNotes = sorted.filter((e) => e.notes.trim());
  if (withNotes.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Per-electrode notes", margin, y);
    y += 18;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    withNotes.forEach((e) => {
      if (y > pageH - margin) {
        doc.addPage();
        y = margin + 20;
      }
      doc.setFont("helvetica", "bold");
      doc.text(e.name, margin, y);
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(e.notes, pageW - margin * 2 - 70);
      doc.text(lines, margin + 70, y);
      y += Math.max(16, lines.length * 13) + 6;
    });
  }

  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

function drawHeader(
  doc: jsPDF,
  title: string,
  patientLabel: string,
  institution: string | undefined,
  pageW: number,
  margin: number
) {
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(title, margin, margin);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  const meta = [patientLabel, institution].filter(Boolean).join("  ·  ");
  if (meta) doc.text(meta, margin, margin + 16);
  doc.text(new Date().toLocaleDateString(), pageW - margin, margin, { align: "right" });
  doc.setTextColor(0);
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
