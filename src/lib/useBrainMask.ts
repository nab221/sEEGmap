// Load a view's outline image once and turn it into a brain mask, shared by the canvas
// and the side list.

import { useEffect, useState } from "react";
import type { AxialViewId } from "../types";
import { AXIAL_VIEWS, axialImageUrl } from "./axialViews";
import { buildBrainMask, type BrainMask } from "./brainMask";

const cache = new Map<AxialViewId, Promise<BrainMask>>();
const ready = new Map<AxialViewId, BrainMask>();

function loadMask(viewId: AxialViewId): Promise<BrainMask> {
  let p = cache.get(viewId);
  if (!p) {
    p = new Promise<BrainMask>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const { width, height, maskSeals } = AXIAL_VIEWS[viewId];
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const mask = buildBrainMask(ctx.getImageData(0, 0, width, height).data, width, height, 230, maskSeals);
        ready.set(viewId, mask);
        resolve(mask);
      };
      img.onerror = () => {
        cache.delete(viewId);
        reject(new Error(`Could not load ${AXIAL_VIEWS[viewId].imageFile}`));
      };
      img.src = axialImageUrl(viewId);
    });
    cache.set(viewId, p);
  }
  return p;
}

/** The view's brain mask, or null until its image has loaded. */
export function useBrainMask(viewId: AxialViewId | null | undefined): BrainMask | null {
  const [mask, setMask] = useState<BrainMask | null>(() => (viewId ? ready.get(viewId) ?? null : null));
  useEffect(() => {
    if (!viewId) {
      setMask(null);
      return;
    }
    let live = true;
    setMask(ready.get(viewId) ?? null);
    loadMask(viewId).then(
      (m) => live && setMask(m),
      (err) => console.error(err)
    );
    return () => {
      live = false;
    };
  }, [viewId]);
  return mask;
}

/** Fraction of the image that counts as brain; a sanity check that the background didn't leak in. */
export function maskCoverage(mask: BrainMask): number {
  let n = 0;
  for (let k = 0; k < mask.data.length; k++) n += mask.data[k];
  return n / mask.data.length;
}

/** Load a view's mask outside React (verification, export). */
export const loadBrainMask = loadMask;
