import type { Electrode } from "../types";

export const LOBE_CODES: Record<string, string> = {
  F: "Frontal",
  T: "Temporal",
  P: "Parietal",
  O: "Occipital",
  I: "Insular",
  C: "Cingulate",
};

export const AMP_CODES: Record<string, string> = {
  A: "Anterior",
  M: "Middle",
  P: "Posterior",
};

export const SMI_CODES: Record<string, string> = {
  S: "Superior",
  M: "Middle",
  I: "Inferior",
};

export interface ParsedLateralMedialName {
  side: "L" | "R";
  lobe: string;
  amp: "A" | "M" | "P";
  smi: "S" | "M" | "I";
}

/** Parse a 4-character lateral-medial electrode code, e.g. "LTMI" -> L, Temporal, Middle, Inferior. */
export function parseLateralMedialName(raw: string): ParsedLateralMedialName | null {
  const name = raw.trim().toUpperCase();
  if (name.length !== 4) return null;
  const [side, lobe, amp, smi] = name.split("");
  if (side !== "L" && side !== "R") return null;
  if (!LOBE_CODES[lobe]) return null;
  if (!AMP_CODES[amp]) return null;
  if (!SMI_CODES[smi]) return null;
  return {
    side: side as "L" | "R",
    lobe,
    amp: amp as "A" | "M" | "P",
    smi: smi as "S" | "M" | "I",
  };
}

export function buildLateralMedialName(
  side: "L" | "R",
  lobe: string,
  amp: "A" | "M" | "P",
  smi: "S" | "M" | "I"
): string {
  return `${side}${lobe}${amp}${smi}`;
}

export function buildSuperiorInferiorName(
  side: "L" | "R",
  ap: "A" | "P",
  structure: string
): string {
  return `${side}${ap}${structure.trim().toUpperCase()}`;
}

/** Determine the next unused lesion suffix (A, B, C, ...) for a given side among existing electrodes. */
export function nextLesionName(side: "L" | "R", electrodes: Electrode[]): string {
  const prefix = `${side}LES`;
  const used = new Set(
    electrodes
      .map((e) => e.name.toUpperCase())
      .filter((n) => n.startsWith(prefix) && n.length === prefix.length + 1)
      .map((n) => n[n.length - 1])
  );
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!used.has(letter)) return `${prefix}${letter}`;
  }
  return `${prefix}${Date.now()}`;
}

export function isNameTaken(name: string, electrodes: Electrode[], excludeId?: string): boolean {
  return electrodes.some(
    (e) => e.id !== excludeId && e.name.toUpperCase() === name.toUpperCase()
  );
}

/**
 * The legend letter for the electrode at zero-based position `index` in the list:
 * A, B, ... Z, then AA, AB, ... (spreadsheet-column style), matching the Natus
 * convention of lettered electrodes with numbered contacts (A-1, A-2, B-1, ...).
 */
export function electrodeLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
