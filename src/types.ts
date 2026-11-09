// Core data model for sEEGmap.
// Coordinates are normalized (0..1) relative to the full brain figure image (the
// currently selected FigureId), which is the single master coordinate system for the
// whole workspace.

export type Point = { x: number; y: number };

/**
 * Which brain figure a plan / library is drawn on.
 *  - "legacy": the original brain-template.png (1770 x 1281 px)
 *  - "v2":     the newer, more detailed brain-template-v2.png (3147 x 1903 px)
 * Plans made before figures existed are always "legacy".
 */
export type FigureId = "legacy" | "v2";

export type ElectrodeType = "lateral-medial" | "superior-inferior" | "grid";

export interface BaseElectrode {
  id: string;
  name: string;
  color: string;
  entryName: string;
  targetName: string;
  notes: string;
  /** Whether the target X marker is shown on the planner canvas. */
  showTarget: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface LateralMedialElectrode extends BaseElectrode {
  type: "lateral-medial";
  entry: Point;
  target: Point;
}

export interface SuperiorInferiorElectrode extends BaseElectrode {
  type: "superior-inferior";
  lateralStart: Point;
  lateralEnd: Point;
  /**
   * Optional deep-end marker (X) on the same hemisphere's *medial* view, for an
   * in-plane trajectory whose tip reaches mesial structures (e.g. a temporal-pole
   * electrode ending near the amygdala). Absent on most electrodes.
   */
  medialTarget?: Point;
}

/**
 * Subdural grid / strip electrode.
 *
 * Geometry is a rotatable rectangle: a normalized center on the template, plus
 * width/height in *isotropic* units (fractions of REF_W on both axes) so a square
 * grid stays square even though the template image is not square, and so rotation
 * never distorts the array. `rotation` is degrees clockwise about the center.
 */
export interface GridElectrode extends BaseElectrode {
  type: "grid";
  /** Contact rows (1 for a strip). */
  rows: number;
  /** Contact columns. */
  cols: number;
  /** Center of the array, normalized 0..1 on the template. */
  center: Point;
  /** Array width, as a fraction of REF_W. */
  width: number;
  /** Array height, also as a fraction of REF_W (isotropic units). */
  height: number;
  /** Clockwise rotation about the center, in degrees. */
  rotation: number;
  /** Whether contact numbers are drawn inside the contacts. */
  contactNumbers: boolean;
}

export type Electrode = LateralMedialElectrode | SuperiorInferiorElectrode | GridElectrode;

export interface FreehandSketch {
  id: string;
  label: string;
  points: Point[];
  color: string;
  opacity: number;
  createdAt: string;
  updatedAt: string;
}

/** Free-standing text label placed on the canvas, independent of any electrode. */
export interface TextAnnotation {
  id: string;
  content: string;
  /** Anchor point, normalized 0..1 on the template; the text is centered on it. */
  position: Point;
  color: string;
  /** Font size in REF pixel units, so it scales with the canvas. */
  fontSize: number;
  bold: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AnatomyRecord {
  id: string;
  targetName: string;
  preferredEntry: string;
  targetX: number;
  targetY: number;
  entryX: number;
  entryY: number;
  category: string;
  comments: string;
  electrodeName: string;
  fileOrder: number;
  /** Which figure's library this record belongs to. Missing on old records = "legacy". */
  figure?: FigureId;
}

export interface AppConfig {
  institution: string;
  contact: string;
  email: string;
  phone: string;
}

export interface QuadrantConfig {
  label: string;
  bbox: [number, number, number, number];
  anteriorAtStart: boolean;
}

export interface BrainRegionsConfig {
  referenceWidth: number;
  referenceHeight: number;
  quadrants: {
    leftLateral: QuadrantConfig;
    rightLateral: QuadrantConfig;
    leftMedial: QuadrantConfig;
    rightMedial: QuadrantConfig;
  };
  grid: { columns: string[]; rows: string[] };
}

export interface SIAnchor {
  lateralStart: [number, number];
  lateralEnd: [number, number];
  preferredEntry?: string;
  targetName?: string;
}

export type SIRegionsConfig = Record<string, SIAnchor>;

export interface SeegPlanFile {
  formatVersion: string;
  appVersion: string;
  createdAt: string;
  updatedAt: string;
  patientLabel: string;
  planNotes: string;
  electrodes: Electrode[];
  sketches: FreehandSketch[];
  /** Optional: absent in files written before text annotations existed. */
  texts?: TextAnnotation[];
  /** Optional: which figure the plan was made on. Absent in older files = "legacy". */
  figure?: FigureId;
}

export const CURRENT_FORMAT_VERSION = "1.0";
