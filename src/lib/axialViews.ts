// Outline registry for the Electrode view page.
//
// Axial outlines (bottom-up, top-down) have anterior at the top. Seen from above, the
// patient's left is on the viewer's left; seen from below it is on the viewer's right (as
// on an axial MRI slice). Sagittal outlines (lateral, medial) are cut from the Planner's
// newer figure by scripts/assets/make_sagittal_views.py and keep the Planner's
// arrangement: each hemisphere's medial view faces the same way as its lateral view.
// Sizes, midlines and outline extents were measured from the images in public/.

import type { AxialViewId } from "../types";
import type { Hemisphere } from "./axial";

export interface AxialViewConfig {
  id: AxialViewId;
  /** Axial (seen from below/above) or sagittal (one hemisphere's lateral/medial surface). */
  kind: "axial" | "sagittal";
  /** Short name, e.g. in the view picker. */
  label: string;
  /** Used in export file names, e.g. "left-lateral". */
  fileSlug: string;
  /** Image file, relative to public/. */
  imageFile: string;
  /** Native pixel size of the image. */
  width: number;
  height: number;
  /** x of the interhemispheric fissure, in native pixels. Unused on sagittal views. */
  midlineX: number;
  /** Millimetres per native pixel: about 170 mm front to back over the outline. */
  mmPerPx: number;
  /** True when the patient's left is on the viewer's left. */
  patientLeftOnViewerLeft: boolean;
  /** Sagittal only: whose hemisphere this is. */
  hemisphere?: Hemisphere;
  /** Sagittal only: the same view of the other hemisphere, for Mirror to R/L. */
  counterpart?: AxialViewId;
  /** Blank margin round the outline, as fractions of the image size, so outside contacts stay on the figure. */
  margin: { x: number; y: number };
}

/** Front-to-back length of a typical adult brain, used to scale the outlines. */
const BRAIN_LENGTH_MM = 170;

const AXIAL_MARGIN = { x: 0.2, y: 0.06 };
const SAGITTAL_MARGIN = { x: 0.15, y: 0.35 };

export const AXIAL_VIEWS: Record<AxialViewId, AxialViewConfig> = {
  inferior: {
    id: "inferior",
    kind: "axial",
    label: "Bottom-up",
    fileSlug: "bottom-up",
    imageFile: "axial-inferior.png",
    width: 429,
    height: 529,
    midlineX: 214,
    // Outline spans y 4..517.
    mmPerPx: BRAIN_LENGTH_MM / (517 - 4),
    patientLeftOnViewerLeft: false,
    margin: AXIAL_MARGIN,
  },
  superior: {
    id: "superior",
    kind: "axial",
    label: "Top-down",
    fileSlug: "top-down",
    imageFile: "axial-superior.png",
    width: 452,
    height: 530,
    midlineX: 220,
    // Outline spans y 0..521.
    mmPerPx: BRAIN_LENGTH_MM / (521 - 0),
    patientLeftOnViewerLeft: true,
    margin: AXIAL_MARGIN,
  },
  leftLateral: {
    id: "leftLateral",
    kind: "sagittal",
    label: "Left lateral",
    fileSlug: "left-lateral",
    imageFile: "view-left-lateral.png",
    width: 1606,
    height: 1009,
    midlineX: 803,
    // Outline spans x 82..1574.
    mmPerPx: BRAIN_LENGTH_MM / (1574 - 82),
    patientLeftOnViewerLeft: true,
    hemisphere: "L",
    counterpart: "rightLateral",
    margin: SAGITTAL_MARGIN,
  },
  leftMedial: {
    id: "leftMedial",
    kind: "sagittal",
    label: "Left medial",
    fileSlug: "left-medial",
    imageFile: "view-left-medial.png",
    width: 1606,
    height: 990,
    midlineX: 803,
    // Outline spans x 56..1572.
    mmPerPx: BRAIN_LENGTH_MM / (1572 - 56),
    patientLeftOnViewerLeft: true,
    hemisphere: "L",
    counterpart: "rightMedial",
    margin: SAGITTAL_MARGIN,
  },
  rightLateral: {
    id: "rightLateral",
    kind: "sagittal",
    label: "Right lateral",
    fileSlug: "right-lateral",
    imageFile: "view-right-lateral.png",
    width: 1637,
    height: 1010,
    midlineX: 818,
    // Outline spans x 74..1566.
    mmPerPx: BRAIN_LENGTH_MM / (1566 - 74),
    patientLeftOnViewerLeft: false,
    hemisphere: "R",
    counterpart: "leftLateral",
    margin: SAGITTAL_MARGIN,
  },
  rightMedial: {
    id: "rightMedial",
    kind: "sagittal",
    label: "Right medial",
    fileSlug: "right-medial",
    imageFile: "view-right-medial.png",
    width: 1637,
    height: 989,
    midlineX: 818,
    // Outline spans x 46..1563.
    mmPerPx: BRAIN_LENGTH_MM / (1563 - 46),
    patientLeftOnViewerLeft: false,
    hemisphere: "R",
    counterpart: "leftMedial",
    margin: SAGITTAL_MARGIN,
  },
};

/** Order the views are shown on the page. */
export const AXIAL_VIEW_ORDER: AxialViewId[] = [
  "inferior",
  "superior",
  "leftLateral",
  "leftMedial",
  "rightLateral",
  "rightMedial",
];

export function isAxialViewId(v: unknown): v is AxialViewId {
  return typeof v === "string" && (AXIAL_VIEW_ORDER as string[]).includes(v);
}

/** Views offered for an electrode: axial first, then its own side, then the other side. */
export function viewPickerOrder(hemisphere: Hemisphere | null): AxialViewId[] {
  if (hemisphere === "R") return ["inferior", "superior", "rightLateral", "rightMedial", "leftLateral", "leftMedial"];
  return AXIAL_VIEW_ORDER;
}

/** URL of a view's outline image, resolved against the app's base path. */
export function axialImageUrl(id: AxialViewId): string {
  return `${import.meta.env.BASE_URL}${AXIAL_VIEWS[id].imageFile}`;
}
