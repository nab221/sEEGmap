// How each contact state is drawn, shared by the Electrode view canvas and its legend key so
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
  /** Draw a diagonal slash through the dot (⊘). */
  slash: boolean;
}

export const TISSUE_STYLE: Record<Tissue, TissueStyle> = {
  grey: { label: "Grey matter", fill: "#555555", stroke: null, opacity: 1, cross: false, slash: false },
  white: { label: "White matter", fill: "#ffffff", stroke: "#222222", opacity: 1, cross: false, slash: false },
  noisy: { label: "Noisy / lost", fill: "#ffffff", stroke: "#222222", opacity: 1, cross: false, slash: true },
  outside: { label: "Outside brain", fill: null, stroke: "#8a8a8a", opacity: 0.85, cross: true, slash: false },
};

export const TISSUE_KEY_ORDER: Tissue[] = ["grey", "white", "noisy", "outside"];
