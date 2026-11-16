import { describe, expect, it } from "vitest";
import { formatMdtDate, isMdtEmpty, mdtPlainText, parseNoteText, pdfSafe, EMPTY_MDT } from "./mdtNote";

describe("parseNoteText", () => {
  it("keeps paragraphs and collapses blank lines into one gap", () => {
    expect(parseNoteText("First line\n\n\n\nSecond line\n\n")).toEqual([
      { kind: "para", text: "First line" },
      { kind: "gap" },
      { kind: "para", text: "Second line" },
    ]);
  });

  it("reads '#' lines and short lines ending in ':' as headings", () => {
    expect(parseNoteText("# Summary\nBackground:\nThe team agreed the following:")).toEqual([
      { kind: "heading", text: "Summary" },
      { kind: "heading", text: "Background" },
      { kind: "heading", text: "The team agreed the following" },
    ]);
  });

  it("reads bullets from '-', '*', '•' and indented Outlook 'o' sub-bullets", () => {
    expect(parseNoteText("- one\n* two\n•\tthree\n    o   sub")).toEqual([
      { kind: "bullet", text: "one", level: 0 },
      { kind: "bullet", text: "two", level: 0 },
      { kind: "bullet", text: "three", level: 0 },
      { kind: "bullet", text: "sub", level: 1 },
    ]);
  });

  it("does not treat a sentence starting with 'o' as a bullet", () => {
    expect(parseNoteText("o dear")).toEqual([{ kind: "para", text: "o dear" }]);
  });

  it("reads numbered and lettered lists", () => {
    expect(parseNoteText("1. Implant\n2) Record\n  a) sub point")).toEqual([
      { kind: "numbered", marker: "1.", text: "Implant", level: 0 },
      { kind: "numbered", marker: "2)", text: "Record", level: 0 },
      { kind: "numbered", marker: "a)", text: "sub point", level: 1 },
    ]);
  });

  it("bolds short 'Label: text' labels but not times or long phrases", () => {
    expect(parseNoteText("Plan: proceed to SEEG\nMet at 10:30 today\nThis is a much longer opening clause: then text")).toEqual([
      { kind: "para", label: "Plan", text: "proceed to SEEG" },
      { kind: "para", text: "Met at 10:30 today" },
      { kind: "para", text: "This is a much longer opening clause: then text" },
    ]);
  });

  it("ignores Windows line endings and non-breaking spaces from pasted text", () => {
    expect(parseNoteText("A B\r\n\r\nC")).toEqual([
      { kind: "para", text: "A B" },
      { kind: "gap" },
      { kind: "para", text: "C" },
    ]);
  });
});

describe("formatMdtDate", () => {
  it("formats ISO dates in UK style and leaves other text alone", () => {
    expect(formatMdtDate("2026-11-12")).toBe("12 November 2026");
    expect(formatMdtDate("")).toBe("");
    expect(formatMdtDate("next week")).toBe("next week");
  });
});

describe("pdfSafe", () => {
  it("keeps Windows-1252 text and replaces symbols the PDF font lacks", () => {
    expect(pdfSafe("“Café” – 5 µV • ok")).toBe("“Café” – 5 µV • ok");
    expect(pdfSafe("SOZ → R mesial ≥ 2 ✓")).toBe("SOZ -> R mesial >= 2 Yes");
    expect(pdfSafe("海")).toBe("?");
  });
});

describe("isMdtEmpty / mdtPlainText", () => {
  it("is empty only with no fields and no discussion", () => {
    expect(isMdtEmpty(EMPTY_MDT, "  ")).toBe(true);
    expect(isMdtEmpty({ ...EMPTY_MDT, outcome: "x" }, "")).toBe(false);
    expect(isMdtEmpty({ ...EMPTY_MDT, investigations: "MRI: normal" }, "")).toBe(false);
  });

  it("writes a plain-text version with the default meeting name", () => {
    expect(mdtPlainText({ ...EMPTY_MDT, date: "2026-11-12", investigations: "MRI: normal", outcome: "Go" }, "Talked")).toEqual([
      "Epilepsy Surgery MDT — 12 November 2026",
      "",
      "Previous investigations:",
      "MRI: normal",
      "",
      "Discussion:",
      "Talked",
      "",
      "Outcome / decision:",
      "Go",
    ]);
  });
});
