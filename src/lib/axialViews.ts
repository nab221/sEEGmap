// Axial outline registry for the Axial view page.
//
// Both outlines have anterior at the top. Seen from above, the patient's left is on the
// viewer's left; seen from below it is on the viewer's right (as on an axial MRI slice).
// Sizes, midlines and outline extents were measured from the images in public/.

import type { AxialViewId } from "../types";

export interface AxialViewConfig {
  id: AxialViewId;
  /** Short name, e.g. in the view picker. */
  label: string;
  /** Where the outline is seen from, shown next to the label. */
  caption: string;
  /** Image file, relative to public/. */
  imageFile: string;
  /** Native pixel size of the image. */
  width: number;
  height: number;
  /** x of the interhemispheric fissure, in native pixels. */
  midlineX: number;
  /** Millimetres per native pixel: about 170 mm front to back over the outline's height. */
  mmPerPx: number;
  /** True when the patient's left is on the viewer's left. */
  patientLeftOnViewerLeft: boolean;
}

/** Front-to-back length of a typical adult brain, used to scale the outlines. */
const BRAIN_LENGTH_MM = 170;

export const AXIAL_VIEWS: Record<AxialViewId, AxialViewConfig> = {
  inferior: {
    id: "inferior",
    label: "Bottom-up",
    caption: "from below",
    imageFile: "axial-inferior.png",
    width: 429,
    height: 529,
    midlineX: 214,
    // Outline spans y 4..517.
    mmPerPx: BRAIN_LENGTH_MM / (517 - 4),
    patientLeftOnViewerLeft: false,
  },
  superior: {
    id: "superior",
    label: "Top-down",
    caption: "from above",
    imageFile: "axial-superior.png",
    width: 452,
    height: 530,
    midlineX: 220,
    // Outline spans y 0..521.
    mmPerPx: BRAIN_LENGTH_MM / (521 - 0),
    patientLeftOnViewerLeft: true,
  },
};

/** Order the views are shown on the page: bottom-up first. */
export const AXIAL_VIEW_ORDER: AxialViewId[] = ["inferior", "superior"];

/** URL of a view's outline image, resolved against the app's base path. */
export function axialImageUrl(id: AxialViewId): string {
  return `${import.meta.env.BASE_URL}${AXIAL_VIEWS[id].imageFile}`;
}
