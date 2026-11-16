// The MDT note: the meeting where the implantation plan was discussed. The discussion text
// is usually pasted from the MDT minutes, so it is parsed loosely into headings, bullet
// and numbered lists and paragraphs; the PDF page and the on-screen preview both draw
// from these blocks so they always match.

import type { MdtNote } from "../types";

export const EMPTY_MDT: MdtNote = { meeting: "", date: "", attendees: "", investigations: "", outcome: "" };

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
  return text
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
    !mdt.investigations.trim() &&
    !mdt.outcome.trim() &&
    !mdt.attendees.trim() &&
    !mdt.date.trim() &&
    !mdt.meeting.trim()
  );
}

/** Characters jsPDF's built-in fonts can't draw, replaced with readable stand-ins. */
const PDF_REPLACEMENTS: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "↔": "<->",
  "⇒": "=>",
  "↑": "^",
  "↓": "v",
  "≥": ">=",
  "≤": "<=",
  "≠": "!=",
  "≈": "~",
  "−": "-",
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "✓": "Yes",
  "✔": "Yes",
  "✗": "x",
  "✘": "x",
  "◦": "-",
  "▪": "-",
  "▫": "-",
  "‣": "-",
  "⁃": "-",
};

/**
 * Make text safe for jsPDF's standard Helvetica, which only covers Windows-1252: common
 * symbols become ASCII stand-ins and anything else unknown becomes "?", rather than the
 * garbled glyphs jsPDF would otherwise print.
 */
export function pdfSafe(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (PDF_REPLACEMENTS[ch] !== undefined) out += PDF_REPLACEMENTS[ch];
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
  if (mdt.investigations.trim()) lines.push("", "Previous investigations:", mdt.investigations.trim());
  lines.push("", "Discussion:", discussion.trim() || "(none)");
  if (mdt.outcome.trim()) lines.push("", "Outcome / decision:", mdt.outcome.trim());
  return lines;
}
