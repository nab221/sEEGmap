// The MDT note: the meeting where the implantation plan was discussed. The discussion text
// is usually pasted from the MDT minutes, so it is parsed loosely into headings, bullet
// and numbered lists and paragraphs; the PDF page and the on-screen preview both draw
// from these blocks so they always match.

import type { MdtNote, MdtSeizure } from "../types";

export const EMPTY_MDT: MdtNote = { meeting: "", date: "", attendees: "", seizures: [], investigations: "", outcome: "" };

/**
 * An MDT note read from storage or a .seegmap file, with every field present: older saves
 * lack the newer fields, and a hand-edited file may have the wrong types.
 */
export function normaliseMdt(raw: Partial<MdtNote> | undefined | null): MdtNote {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const seizures = Array.isArray(raw?.seizures) ? raw.seizures : [];
  return {
    meeting: str(raw?.meeting),
    date: str(raw?.date),
    attendees: str(raw?.attendees),
    seizures: seizures
      .filter((sz): sz is MdtSeizure => !!sz && typeof sz === "object")
      .map((sz, i) => ({
        id: str(sz.id) || `seizure-${i + 1}`,
        label: str(sz.label),
        description: str(sz.description),
        frequency: str(sz.frequency),
      })),
    investigations: str(raw?.investigations),
    outcome: str(raw?.outcome),
  };
}

/** Seizures with anything typed in them; blank rows are left off the printed note. */
export function filledSeizures(seizures: MdtSeizure[]): MdtSeizure[] {
  return seizures.filter((sz) => sz.label.trim() || sz.description.trim() || sz.frequency.trim());
}

/** "Seizure 2: Habitual" or "Seizure 2" — `index` is 0-based. */
export function seizureTitle(sz: MdtSeizure, index: number): string {
  const label = sz.label.trim();
  return label ? `Seizure ${index + 1}: ${label}` : `Seizure ${index + 1}`;
}

/** Meeting name used when none is typed. */
export const DEFAULT_MEETING = "Epilepsy Surgery MDT";

export type NoteBlock =
  | { kind: "heading"; text: string }
  | { kind: "bullet"; text: string; level: number }
  | { kind: "numbered"; text: string; marker: string; level: number }
  | { kind: "para"; text: string; label?: string }
  | { kind: "gap" };

/** A line that is only a short label ending in a colon reads as a heading: "Background:". */
const MAX_HEADING_CHARS = 60;
/** "Plan: proceed to SEEG" — the label is drawn in bold when it is this short. */
const MAX_LABEL_CHARS = 32;
const MAX_LABEL_WORDS = 4;

const BULLET_RE = /^([-*•◦▪▫‣⁃·o])\s+(.*)$/;
const NUMBER_RE = /^(\(?(?:\d{1,3}|[a-zA-Z]|[ivxIVX]{1,4})[.)])\s+(.*)$/;
const LABEL_RE = /^([^:]{1,32}):\s+(\S.*)$/;

/** Parse pasted or typed MDT text into display blocks. Consecutive blank lines collapse to one gap. */
export function parseNoteText(text: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  const lines = normaliseText(text).split("\n");

  for (const raw of lines) {
    const indent = leadingIndent(raw);
    const line = raw.trim();
    if (!line) {
      if (blocks.length && blocks[blocks.length - 1].kind !== "gap") blocks.push({ kind: "gap" });
      continue;
    }
    const level = indent >= 2 ? 1 : 0;

    const md = /^#{1,6}\s+(.*)$/.exec(line);
    if (md) {
      blocks.push({ kind: "heading", text: md[1].trim() });
      continue;
    }
    const bullet = BULLET_RE.exec(line);
    // A lone "o" is the Word/Outlook sub-bullet glyph; only treat it as a bullet when indented
    // or followed by a tab-sized gap, so a sentence starting "o ..." is unlikely to be caught.
    if (bullet && (bullet[1] !== "o" || indent > 0 || /^o\s{2,}/.test(raw.trimStart()))) {
      blocks.push({ kind: "bullet", text: bullet[2].trim(), level: bullet[1] === "o" || bullet[1] === "◦" ? 1 : level });
      continue;
    }
    const numbered = NUMBER_RE.exec(line);
    if (numbered && numbered[2]) {
      blocks.push({ kind: "numbered", marker: numbered[1], text: numbered[2].trim(), level });
      continue;
    }
    if (line.endsWith(":") && line.length <= MAX_HEADING_CHARS && !line.slice(0, -1).includes(":")) {
      blocks.push({ kind: "heading", text: line.slice(0, -1).trim() });
      continue;
    }
    const labelled = LABEL_RE.exec(line);
    if (labelled && labelled[1].trim().length <= MAX_LABEL_CHARS && labelled[1].trim().split(/\s+/).length <= MAX_LABEL_WORDS && !/\d$/.test(labelled[1])) {
      blocks.push({ kind: "para", label: labelled[1].trim(), text: labelled[2].trim() });
      continue;
    }
    blocks.push({ kind: "para", text: line });
  }
  while (blocks.length && blocks[blocks.length - 1].kind === "gap") blocks.pop();
  return blocks;
}

/** Unify line endings, tabs and the odd spaces that come with text pasted from Word or email. */
function normaliseText(text: string): string {
  return applySymbolShortcuts(text)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/[  -   　]/g, " ")
    .replace(/[​-‍﻿]/g, "");
}

function leadingIndent(line: string): number {
  return line.length - line.trimStart().length;
}

/** "2026-11-12" → "12 November 2026"; anything that isn't an ISO date is returned as typed. */
export function formatMdtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso.trim();
  // Built from parts so the day never shifts with the time zone.
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** True when nothing has been entered for the MDT note itself. */
export function isMdtEmpty(mdt: MdtNote, discussion: string): boolean {
  return (
    !discussion.trim() &&
    filledSeizures(mdt.seizures).length === 0 &&
    !mdt.investigations.trim() &&
    !mdt.outcome.trim() &&
    !mdt.attendees.trim() &&
    !mdt.date.trim() &&
    !mdt.meeting.trim()
  );
}

/**
 * Characters Helvetica lacks that the PDF's other built-in fonts have: arrows, maths signs
 * and Greek letters from Symbol, check marks from ZapfDingbats. `code` is the character in
 * that font's own encoding and `w` its advance width in 1/1000 em (Adobe's font metrics:
 * jsPDF doesn't measure these fonts correctly, so text spacing and wrapping use these).
 */
export const PDF_SYMBOLS: Record<string, { font: "symbol" | "zapfdingbats"; code: string; w: number }> = {};
const symbol = (chars: string, code: string, w: number) => {
  for (const ch of chars) PDF_SYMBOLS[ch] = { font: "symbol", code, w };
};
symbol("→", "\xae", 987);
symbol("←", "\xac", 987);
symbol("↔", "\xab", 1042);
symbol("↑", "\xad", 603);
symbol("↓", "\xaf", 603);
symbol("⇒", "\xde", 987);
symbol("⇐", "\xdc", 987);
symbol("⇔", "\xdb", 1042);
symbol("≥", "\xb3", 549);
symbol("≤", "\xa3", 549);
symbol("≠", "\xb9", 549);
symbol("≈", "\xbb", 549);
symbol("≡", "\xba", 549);
symbol("∞", "\xa5", 713);
symbol("−", "-", 549);
// Greek: lower case, then the capitals that differ from Latin ones.
const GREEK: [string, string, number][] = [
  ["α", "a", 631], ["β", "b", 549], ["γ", "g", 411], ["δ", "d", 494], ["ε", "e", 439],
  ["ζ", "z", 494], ["η", "h", 603], ["θ", "q", 521], ["ι", "i", 329], ["κ", "k", 549],
  ["λ", "l", 549], ["ν", "n", 521], ["ξ", "x", 493], ["π", "p", 549], ["ρ", "r", 549],
  ["σ", "s", 603], ["τ", "t", 439], ["υ", "u", 576], ["φ", "f", 521], ["χ", "c", 549],
  ["ψ", "y", 686], ["ω", "w", 686], ["μ", "m", 576],
  ["Γ", "G", 603], ["Δ", "D", 612], ["Θ", "Q", 741], ["Λ", "L", 686], ["Ξ", "X", 645],
  ["Π", "P", 768], ["Σ", "S", 592], ["Φ", "F", 763], ["Ψ", "Y", 795], ["Ω", "W", 768],
];
for (const [ch, code, w] of GREEK) symbol(ch, code, w);
PDF_SYMBOLS["✓"] = { font: "zapfdingbats", code: "3", w: 760 };
PDF_SYMBOLS["✔"] = { font: "zapfdingbats", code: "4", w: 846 };

/** Characters no built-in PDF font has, replaced with readable stand-ins. */
const PDF_REPLACEMENTS: Record<string, string> = {
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "✗": "x",
  "✘": "x",
  "◦": "-",
  "▪": "-",
  "▫": "-",
  "‣": "-",
  "⁃": "-",
};

/**
 * Make text safe for the PDF's built-in fonts. Helvetica covers Windows-1252; arrows, maths
 * signs, Greek letters and check marks are kept (they are drawn from Symbol or
 * ZapfDingbats); a few other symbols become stand-ins and anything else unknown becomes "?",
 * rather than the garbled glyphs jsPDF would otherwise print.
 */
export function pdfSafe(text: string): string {
  let out = "";
  for (const ch of applySymbolShortcuts(text)) {
    const code = ch.codePointAt(0)!;
    if (PDF_SYMBOLS[ch]) out += ch;
    else if (PDF_REPLACEMENTS[ch] !== undefined) out += PDF_REPLACEMENTS[ch];
    else if (code < 0x100 || CP1252_EXTRA.has(ch)) out += ch;
    else out += "?";
  }
  return out;
}

/** Windows-1252 characters above Latin-1 (curly quotes, dashes, bullet, euro...). */
const CP1252_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/** The note as plain text, for the PowerPoint notes slide. */
export function mdtPlainText(mdt: MdtNote, discussion: string): string[] {
  const lines: string[] = [];
  const head = [mdt.meeting.trim() || DEFAULT_MEETING, formatMdtDate(mdt.date)].filter(Boolean).join(" — ");
  lines.push(head);
  if (mdt.attendees.trim()) lines.push(`Present: ${mdt.attendees.trim()}`);
  const seizures = filledSeizures(mdt.seizures);
  if (seizures.length) {
    lines.push("", "Seizure semiology and frequency:");
    seizures.forEach((sz, i) => {
      lines.push(`${seizureTitle(sz, i)}${sz.frequency.trim() ? ` — ${sz.frequency.trim()}` : ""}`);
      if (sz.description.trim()) lines.push(sz.description.trim());
    });
  }
  if (mdt.investigations.trim()) lines.push("", "Previous investigations:", mdt.investigations.trim());
  lines.push("", "Discussion:", discussion.trim() || "(none)");
  if (mdt.outcome.trim()) lines.push("", "Outcome / decision:", mdt.outcome.trim());
  return lines.map(applySymbolShortcuts);
}

/**
 * Typed shortcuts printed as symbols. The editor's font (Inter) already draws some of these
 * as arrows on screen, so the printed note matches what was seen while typing.
 */
export const SYMBOL_SHORTCUTS: [string, string][] = [
  ["->", "→"],
  ["<-", "←"],
  ["<->", "↔"],
  ["=>", "⇒"],
  ["<=>", "⇔"],
  [">=", "≥"],
  ["<=", "≤"],
  ["!=", "≠"],
];

const SHORTCUT_MAP = new Map(SYMBOL_SHORTCUTS);
// Longest first, so "<->" isn't read as "<-" followed by ">".
const SHORTCUT_RE = new RegExp(
  [...SHORTCUT_MAP.keys()]
    .sort((a, b) => b.length - a.length)
    .join("|"), // none of these characters is special in a regular expression
  "g"
);

/** Replace typed shortcuts ("->", ">=", …) with the symbols they stand for. */
export function applySymbolShortcuts(text: string): string {
  return text.replace(SHORTCUT_RE, (m) => SHORTCUT_MAP.get(m) ?? m);
}

/** Symbols offered by the editor's Symbols picker; all of them print in the PDF. */
export const SYMBOL_GROUPS: { label: string; symbols: string[] }[] = [
  { label: "Arrows", symbols: ["→", "←", "↔", "↑", "↓", "⇒", "⇐", "⇔"] },
  { label: "Maths", symbols: ["≥", "≤", "≈", "≠", "±", "×", "°", "∞"] },
  { label: "Greek", symbols: ["α", "β", "γ", "δ", "θ", "λ", "μ", "σ", "Δ"] },
  { label: "Marks", symbols: ["✓", "✔", "•", "–", "½"] },
];
