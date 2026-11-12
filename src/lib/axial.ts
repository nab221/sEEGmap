// Geometry and contact-state helpers for the Electrode view page.
//
// Points are normalized 0..1 on a view's image, but distances are worked out in the
// image's native pixels so contact spacing stays true on a non-square image. A shaft is
// a schematic: contacts are spaced at full length from the tip (contact 1, deepest)
// outward, and are never clamped -- contacts past the outline are the point.

import type { AxialPlacement, Point, Tissue } from "../types";
import { isAxialViewId, type AxialViewConfig } from "./axialViews";

export const CONTACT_SPACING_MM = 3.5;
export const DEFAULT_CONTACTS = 10;
export const MIN_CONTACTS = 1;
export const MAX_CONTACTS = 24;

export type Hemisphere = "L" | "R";

/** Every state, in legend and range order. */
export const TISSUE_ORDER: Tissue[] = ["grey", "white", "noisy", "outside"];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Hemisphere from an electrode name's leading L/R, or null. */
export function hemisphereOf(name: string): Hemisphere | null {
  const c = name.trim().charAt(0).toUpperCase();
  return c === "L" || c === "R" ? c : null;
}

/**
 * Next state when a contact is clicked. With `allowOutside`: grey → white → noisy →
 * outside → grey. Without it (the "last in brain" dropdown owns outside): grey → white →
 * noisy → grey, and a stored outside is read as grey first.
 */
export function nextTissue(t: Tissue, allowOutside: boolean): Tissue {
  const cycle: Tissue[] = allowOutside ? TISSUE_ORDER : ["grey", "white", "noisy"];
  const from = cycle.includes(t) ? t : "grey";
  return cycle[(cycle.indexOf(from) + 1) % cycle.length];
}

/**
 * The state each contact is drawn and listed with. When "last in brain" is N, contacts
 * after N are outside and a stored outside at 1..N reads as grey; otherwise the stored
 * marks are used as they are.
 */
export function effectiveTissue(p: AxialPlacement): Tissue[] {
  const tissue = resizeTissue(p.tissue, p.contacts);
  if (p.lastInBrain === undefined) return tissue;
  const n = p.lastInBrain;
  return tissue.map((t, i) => (i >= n ? "outside" : t === "outside" ? "grey" : t));
}

/**
 * Set "last contact in brain". Undefined, non-numbers and values below 1 clear it;
 * others are rounded and capped at the contact count.
 */
export function setLastInBrain(p: AxialPlacement, n: number | undefined): AxialPlacement {
  const { lastInBrain: _drop, ...rest } = p;
  const v = cleanLastInBrain(n, p.contacts);
  return v === undefined ? rest : { ...rest, lastInBrain: v };
}

function cleanLastInBrain(n: unknown, contacts: number): number | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  const v = Math.round(n);
  if (v < 1) return undefined;
  return Math.min(v, contacts);
}

function clampContacts(n: unknown): number {
  // Number() first, so a count stored as text ("15") is read rather than reset.
  const v = Number(n);
  if (n === null || n === "" || !Number.isFinite(v)) return DEFAULT_CONTACTS;
  return Math.min(MAX_CONTACTS, Math.max(MIN_CONTACTS, Math.round(v)));
}

const isPoint = (pt: unknown): pt is Point =>
  !!pt && Number.isFinite((pt as Point).x) && Number.isFinite((pt as Point).y);

/** Tissue list for `n` contacts (clamped to 1..24), keeping existing marks and padding with grey. */
export function resizeTissue(tissue: Tissue[], n: unknown): Tissue[] {
  const count = clampContacts(n);
  return Array.from({ length: count }, (_, i) => tissue[i] ?? "grey");
}

/** Tissue list sized to `contacts`, with anything unrecognised read as grey. */
function cleanTissue(tissue: unknown, contacts: number): Tissue[] {
  const raw = Array.isArray(tissue) ? (tissue as Tissue[]) : [];
  return resizeTissue(raw.map((t) => (TISSUE_ORDER.includes(t) ? t : "grey")), contacts);
}

/**
 * Repair a placement read from storage or a file, so drawing and legends never break.
 * Returns null when it can't be drawn at all (no usable tip, or an unknown view); callers
 * treat that electrode as not placed.
 */
export function normalizeAxial(p: AxialPlacement | null | undefined): AxialPlacement | null {
  if (!p || typeof p !== "object") return null;
  if (!isAxialViewId(p.view)) return null;
  if (!isPoint(p.tip)) return null;
  const tip = { x: p.tip.x, y: p.tip.y };
  // A missing direction falls back to the tip, which draws pointing away from the midline.
  const toward = isPoint(p.toward) ? { x: p.toward.x, y: p.toward.y } : { ...tip };
  const contacts = clampContacts(p.contacts);
  const out: AxialPlacement = { view: p.view, tip, toward, contacts, tissue: cleanTissue(p.tissue, contacts) };
  const last = cleanLastInBrain(p.lastInBrain, contacts);
  if (last !== undefined) out.lastInBrain = last;
  if (typeof p.edgeDist === "number" && Number.isFinite(p.edgeDist) && p.edgeDist > 0) out.edgeDist = p.edgeDist;
  return out;
}

/** Change the contact count, keeping marks and capping "last in brain" at the new count. */
export function withContactCount(p: AxialPlacement, n: number): AxialPlacement {
  const contacts = clampContacts(n);
  const next: AxialPlacement = { ...p, contacts, tissue: resizeTissue(p.tissue, contacts) };
  return p.lastInBrain === undefined ? next : setLastInBrain(next, p.lastInBrain);
}

/**
 * Cycle contact `index` (0-based) to its next state. Out-of-range indexes change nothing,
 * nor do contacts that "last in brain" marks outside.
 */
export function cycleContact(p: AxialPlacement, index: number): AxialPlacement {
  if (index < 0 || index >= p.contacts) return p;
  const tissue = resizeTissue(p.tissue, p.contacts);
  if (p.lastInBrain === undefined) {
    tissue[index] = nextTissue(tissue[index], true);
  } else {
    if (index >= p.lastInBrain) return p;
    tissue[index] = nextTissue(tissue[index], false);
  }
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
 * First placement on a view. Axial views: tip in the electrode's hemisphere *as that view
 * shows it*, shaft pointing laterally out of the brain; names with no L/R go on the
 * viewer's left. Sagittal views: tip near the centre, shaft pointing up. Contacts, marks
 * and "last in brain" carry over from `keep`; a hand-set edge never does, as it belongs
 * to the old view.
 */
export function defaultAxialPlacement(
  view: AxialViewConfig,
  hemisphere: Hemisphere | null,
  keep?: Pick<AxialPlacement, "contacts" | "tissue" | "lastInBrain">
): AxialPlacement {
  const contacts = keep ? clampContacts(keep.contacts) : DEFAULT_CONTACTS;
  const tissue = cleanTissue(keep?.tissue, contacts);
  const withKept = (p: AxialPlacement) => setLastInBrain(p, keep?.lastInBrain);
  if (view.kind === "sagittal") {
    return withKept({ view: view.id, tip: { x: 0.5, y: 0.55 }, toward: { x: 0.5, y: 0.3 }, contacts, tissue });
  }
  const onViewerLeft =
    hemisphere === null || (hemisphere === "L") === view.patientLeftOnViewerLeft;
  const sign = onViewerLeft ? -1 : 1;
  const tipX = view.midlineX + sign * 0.2 * view.width;
  const towardX = tipX + sign * 0.1 * view.width;
  return withKept({
    view: view.id,
    tip: { x: tipX / view.width, y: 0.5 },
    toward: { x: towardX / view.width, y: 0.5 },
    contacts,
    tissue,
  });
}

/**
 * Mirror a placement to the other hemisphere, keeping contacts, marks, "last in brain"
 * and any hand-set edge. Axial views reflect across their own midline. Sagittal views
 * move to the other hemisphere's matching view, flipped left to right (the left and
 * right images face opposite ways).
 */
export function mirrorAxial(p: AxialPlacement, view: AxialViewConfig): AxialPlacement {
  if (view.kind === "sagittal" && view.counterpart) {
    const flipX = (pt: Point): Point => ({ x: 1 - pt.x, y: pt.y });
    return { ...p, view: view.counterpart, tip: flipX(p.tip), toward: flipX(p.toward), tissue: [...p.tissue] };
  }
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
