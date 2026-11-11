// Geometry and tissue helpers for the Axial view page.
//
// Points are normalized 0..1 on a view's image, but distances are worked out in the
// image's native pixels so contact spacing stays true on a non-square image. A shaft is
// a schematic: contacts are spaced at full length from the tip (contact 1, deepest)
// outward, and are never clamped -- contacts past the outline are the point.

import type { AxialPlacement, Point, Tissue } from "../types";
import type { AxialViewConfig } from "./axialViews";

export const CONTACT_SPACING_MM = 3.5;
export const DEFAULT_CONTACTS = 10;
export const MIN_CONTACTS = 1;
export const MAX_CONTACTS = 24;

export type Hemisphere = "L" | "R";

const TISSUE_ORDER: Tissue[] = ["grey", "white", "outside"];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Hemisphere from an electrode name's leading L/R, or null. */
export function hemisphereOf(name: string): Hemisphere | null {
  const c = name.trim().charAt(0).toUpperCase();
  return c === "L" || c === "R" ? c : null;
}

/** Next state when a contact is clicked: grey → white → outside → grey. */
export function nextTissue(t: Tissue): Tissue {
  return TISSUE_ORDER[(TISSUE_ORDER.indexOf(t) + 1) % TISSUE_ORDER.length];
}

function clampContacts(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CONTACTS;
  return Math.min(MAX_CONTACTS, Math.max(MIN_CONTACTS, Math.round(n)));
}

/** Tissue list for `n` contacts (clamped to 1..24), keeping existing marks and padding with grey. */
export function resizeTissue(tissue: Tissue[], n: number): Tissue[] {
  const count = clampContacts(n);
  return Array.from({ length: count }, (_, i) => tissue[i] ?? "grey");
}

/** Tissue list sized to `contacts`, with anything unrecognised read as grey. */
function cleanTissue(tissue: unknown, contacts: number): Tissue[] {
  const raw = Array.isArray(tissue) ? (tissue as Tissue[]) : [];
  return resizeTissue(raw.map((t) => (TISSUE_ORDER.includes(t) ? t : "grey")), contacts);
}

/** Repair a placement read from storage or a file, so drawing and legends never break. */
export function normalizeAxial(p: AxialPlacement): AxialPlacement {
  const contacts = clampContacts(p.contacts);
  return { ...p, contacts, tissue: cleanTissue(p.tissue, contacts) };
}

export function withContactCount(p: AxialPlacement, n: number): AxialPlacement {
  const contacts = clampContacts(n);
  return { ...p, contacts, tissue: resizeTissue(p.tissue, contacts) };
}

/** Cycle contact `index` (0-based) to its next tissue state. Out-of-range indexes change nothing. */
export function cycleContact(p: AxialPlacement, index: number): AxialPlacement {
  if (index < 0 || index >= p.contacts) return p;
  const tissue = resizeTissue(p.tissue, p.contacts);
  tissue[index] = nextTissue(tissue[index]);
  return { ...p, tissue };
}

/** Contact spacing in native pixels. */
function spacingPx(view: AxialViewConfig): number {
  return CONTACT_SPACING_MM / view.mmPerPx;
}

/** Unit direction from tip outward, in native pixels. Falls back to pointing away from the midline. */
function directionPx(p: AxialPlacement, view: AxialViewConfig): Point {
  const dx = (p.toward.x - p.tip.x) * view.width;
  const dy = (p.toward.y - p.tip.y) * view.height;
  const len = Math.hypot(dx, dy);
  if (len > 1e-9) return { x: dx / len, y: dy / len };
  const tipPx = p.tip.x * view.width;
  return { x: tipPx > view.midlineX ? 1 : -1, y: 0 };
}

/** Point `steps` contact spacings out from the tip, normalized. */
function alongShaft(p: AxialPlacement, view: AxialViewConfig, steps: number): Point {
  const d = directionPx(p, view);
  const s = spacingPx(view) * steps;
  return {
    x: p.tip.x + (d.x * s) / view.width,
    y: p.tip.y + (d.y * s) / view.height,
  };
}

/** Normalized position of every contact; index 0 is the tip (contact 1). */
export function contactPositions(p: AxialPlacement, view: AxialViewConfig): Point[] {
  return Array.from({ length: p.contacts }, (_, i) => alongShaft(p, view, i));
}

/** Where the direction handle sits: one spacing beyond the last contact. */
export function handlePosition(p: AxialPlacement, view: AxialViewConfig): Point {
  return alongShaft(p, view, p.contacts);
}

/** Move the whole shaft. The tip stays on the image; the direction is unchanged. */
export function translateAxial(p: AxialPlacement, dx: number, dy: number): AxialPlacement {
  const tip = { x: clamp01(p.tip.x + dx), y: clamp01(p.tip.y + dy) };
  const ax = tip.x - p.tip.x;
  const ay = tip.y - p.tip.y;
  return { ...p, tip, toward: { x: p.toward.x + ax, y: p.toward.y + ay } };
}

/**
 * First placement on a view: tip in the electrode's hemisphere *as that view shows it*,
 * shaft pointing laterally out of the brain. Names with no L/R go on the viewer's left.
 */
export function defaultAxialPlacement(
  view: AxialViewConfig,
  hemisphere: Hemisphere | null,
  keep?: Pick<AxialPlacement, "contacts" | "tissue">
): AxialPlacement {
  const onViewerLeft =
    hemisphere === null || (hemisphere === "L") === view.patientLeftOnViewerLeft;
  const sign = onViewerLeft ? -1 : 1;
  const tipX = view.midlineX + sign * 0.2 * view.width;
  const towardX = tipX + sign * 0.1 * view.width;
  const contacts = keep ? clampContacts(keep.contacts) : DEFAULT_CONTACTS;
  const tissue = cleanTissue(keep?.tissue, contacts);
  return {
    view: view.id,
    tip: { x: tipX / view.width, y: 0.5 },
    toward: { x: towardX / view.width, y: 0.5 },
    contacts,
    tissue,
  };
}

/** Reflect a placement across the view's midline, keeping contacts and marks. */
export function mirrorAxial(p: AxialPlacement, view: AxialViewConfig): AxialPlacement {
  const mid = view.midlineX / view.width;
  const flip = (pt: Point): Point => ({ x: 2 * mid - pt.x, y: pt.y });
  const tip = flip(p.tip);
  return {
    ...p,
    tip: { x: clamp01(tip.x), y: tip.y },
    toward: flip(p.toward),
    tissue: [...p.tissue],
  };
}

/** Contact ranges per state, e.g. "grey 1–3, 6 · white 4–5 · outside 7". */
export function formatTissueRanges(tissue: Tissue[]): string {
  const parts: string[] = [];
  for (const state of TISSUE_ORDER) {
    const runs: string[] = [];
    let start = -1;
    for (let i = 0; i <= tissue.length; i++) {
      const on = i < tissue.length && tissue[i] === state;
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        runs.push(start === i - 1 ? `${start + 1}` : `${start + 1}–${i}`);
        start = -1;
      }
    }
    if (runs.length) parts.push(`${state} ${runs.join(", ")}`);
  }
  return parts.join(" · ");
}
