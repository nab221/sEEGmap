import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { measure, wrapText } from "./pdfText";

function doc() {
  const d = new jsPDF({ unit: "mm", format: "a4" });
  d.setFont("helvetica", "normal");
  d.setFontSize(10);
  return d;
}

describe("measure", () => {
  it("uses the Symbol font's true width for arrows", () => {
    // 987/1000 em at 10 pt, in mm.
    expect(measure(doc(), "→")).toBeCloseTo((0.987 * 10 * 25.4) / 72, 3);
  });

  it("adds Helvetica and symbol widths", () => {
    const d = doc();
    expect(measure(d, "a → b")).toBeCloseTo(d.getTextWidth("a  b") + measure(d, "→"), 3);
  });
});

describe("wrapText", () => {
  it("keeps every symbol, in order, across wrapped lines", () => {
    const text = "Seizure 1 → generalisation ≥ 2 min, then θ slowing → recovery ‰ ok ".repeat(4).trim();
    const lines = wrapText(doc(), text, 60);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  });

  it("never makes a line wider than asked", () => {
    const d = doc();
    const lines = wrapText(d, "→ ".repeat(80), 50);
    for (const line of lines) expect(measure(d, line.trimEnd())).toBeLessThanOrEqual(50.01);
  });
});
