// How each tissue state is drawn, shared by the Axial view canvas and its legend key so
// the printout and the key always agree. Chosen to stay distinct in black-and-white print.

import type { Tissue } from "../types";

export interface TissueStyle {
  label: string;
  /** Fill colour, or null for a hollow dot. */
  fill: string | null;
  stroke: string | null;
  opacity: number;
  /** Draw a small ✕ inside the dot. */
  cross: boolean;
}

export const TISSUE_STYLE: Record<Tissue, TissueStyle> = {
  grey: { label: "Grey matter", fill: "#555555", stroke: null, opacity: 1, cross: false },
  white: { label: "White matter", fill: "#ffffff", stroke: "#222222", opacity: 1, cross: false },
  outside: { label: "Outside brain", fill: null, stroke: "#8a8a8a", opacity: 0.85, cross: true },
};

export const TISSUE_KEY_ORDER: Tissue[] = ["grey", "white", "outside"];

/** Shown on the page and printed on the exported figure. */
export const SCHEMATIC_NOTE =
  "Schematic: shafts drawn at full length with 3.5 mm contact spacing, as if level in the axial plane.";
