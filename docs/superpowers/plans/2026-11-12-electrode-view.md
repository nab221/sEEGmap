# Electrode View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Axial view page into a post-implant "Electrode view". It offers six outlines, shows only the views in use, adds a fourth contact state ("noisy"), and has a "last contact in brain" dropdown that both marks the outside contacts and fits each shaft to the outline. Each view exports as its own PNG with its own legend.

**Architecture:**
- **Outlines.** Four new outline images (left/right × lateral/medial) are cropped once from the Planner's v2 template by a stdlib Python script.
- **Brain mask.** A pure module builds a brain mask from an outline's pixels: everything not reached by flood-filling the white background from the border. A second function marches along a shaft to find where it first leaves the brain.
- **Fitting.** Spacing is fitted per electrode by pure functions in `axial.ts`. The canvas, side list and exports all use the same `shaftFit` result.
- **Data.** The stored data stays in `electrode.axial`, so old plans load unchanged.

**Tech Stack:** React 18 + TypeScript, Vite, Zustand, Vitest, `html-to-image`, Canvas 2D. Python 3 stdlib only for the asset script.

**Spec:** [docs/superpowers/specs/2026-11-12-electrode-view-design.md](../specs/2026-11-12-electrode-view-design.md)

## Global Constraints

- The Planner (`src/pages/Planner.tsx`, `BrainCanvas.tsx`, its exports) is **not changed**.
- Contact spacing is `CONTACT_SPACING_MM = 3.5`. Contact 1 is the tip, and the number of dots always equals `contacts` (1..24).
- Saved data stays in `electrode.axial` (type `AxialPlacement`). Old plans whose `view` is `"inferior"`/`"superior"` and that have no `lastInBrain` must draw exactly as today, including hand-marked `outside`.
- The four states are drawn so they stay distinct in black-and-white print: grey = filled dark-grey dot; white = white dot with dark outline; noisy = dot with a diagonal slash (⊘); outside = faded hollow dot with ✕.
- Exported view PNGs carry only: the outline, L/R marker(s), electrode names, contact dots, the contact numbers shown on screen, and that view's legend. No title, no "(from below)/(from above)", no schematic note, no ◆ rotate handle, no edge bar.
- Exports are 300 dpi with a pHYs chunk (`canvasToPngWithDpi`).
- Off-scale warning when `|fitted spacing / 3.5 mm − 1| > 0.25`.
- Fully client-side. No new npm dependencies.
- Route stays `/axial`. The nav tab reads **"Electrode view"**.
- Commit after each task to a feature branch (`electrode-view`), never to `main`.

## Review Focus

1. **Old plans.** A saved plan with bottom-up/top-down placements, hand-marked `outside` and no `lastInBrain` must draw the same dots at the same 3.5 mm positions. Pinned in Task 3 (normalize) and Task 4 (nominal positions unchanged).
2. **Tip outside the brain, or shaft pointing inward,** with "last contact in brain" set. Expect standard spacing, a "brain edge not found" warning on the row, and no crash. Pinned in Task 4.
3. **Lowering the contact count below "last contact in brain".** The dropdown clamps to the new count and nothing throws. Pinned in Task 3.
4. **Background leaking into the brain mask** through an anti-aliased or diagonal outline, or where the outline touches the image edge. Every in-brain contact would then look like it's outside. Pinned by a diagonal-line test in Task 2, and by a per-view mask-coverage check in Task 5's browser verification.
5. **Switching an electrode to another view, or mirroring it to the other hemisphere.** Count, marks and `lastInBrain` are kept. A stale `edgeDist` override is dropped on a view switch and kept on a mirror. Pinned in Task 3.

---

### Task 1: Lateral and medial outline images

**Files:**
- Create: `scripts/assets/make_sagittal_views.py`
- Create: `public/view-left-lateral.png`, `public/view-left-medial.png`, `public/view-right-lateral.png`, `public/view-right-medial.png`

**Interfaces:**
- Produces: four RGB PNGs, plus a printed table per image: `file, width, height, outline_x0, outline_x1, outline_y0, outline_y1`. The non-white bounding box is the outline extent, which Task 3 uses for `mmPerPx` (170 mm over `outline_x1 − outline_x0`, since anterior–posterior is horizontal on these views).

- [ ] **Step 1: Write the script, Python 3 stdlib only** (`zlib`, `struct`, `json`), following the style of `scripts/launchers/generate_icons.py`.
  - Read `public/brain-template-v2.png`: 8-bit RGBA, non-interlaced. Unfilter PNG filter types 0–4.
  - Crop each quadrant using the `bbox` `[x0, y0, x1, y1]` from `public/brain-regions-v2.json` `quadrants.{leftLateral,leftMedial,rightLateral,rightMedial}`.
  - Flatten alpha onto white.
  - Remove the red guide lines. A pixel is guide-red when `r > 150 and r - max(g, b) > 80`. Repaint each guide pixel from its nearest non-red neighbours across the line:
    - if the red run through the pixel is longer vertically than horizontally, it's a vertical line, so average the nearest non-red pixel to the left and to the right;
    - otherwise average the nearest non-red pixel above and below.

    This rejoins black outline strokes the line crosses. Plain white-out would leave gaps that the Task 2 flood fill leaks through.
  - Write RGB PNGs to `public/view-<side>-<lateral|medial>.png` and print the table above.

- [ ] **Step 2: Run it**

Run: `python3 scripts/assets/make_sagittal_views.py`
Expected: four files written, four table rows, each outline extent well inside its image.

- [ ] **Step 3: Inspect the four images** (Read tool on each PNG).

Expected:
- no red lines;
- outline strokes unbroken where the lines used to cross;
- insula / hippocampus / amygdala shading kept;
- left lateral and left medial have anterior on the viewer's left; the right-side images have anterior on the right (the Planner's arrangement).

- [ ] **Step 4: Commit**

```bash
git checkout -b electrode-view
git add scripts/assets/make_sagittal_views.py public/view-*.png docs/superpowers/specs/2026-11-12-electrode-view-design.md docs/superpowers/plans/2026-11-12-electrode-view.md
git commit -m "Add lateral and medial outline images for the Electrode view"
```

---

### Task 2: Brain mask and outline crossing

**Files:**
- Create: `src/lib/brainMask.ts`
- Test: `src/lib/brainMask.test.ts`

**Interfaces:**
- Produces:
  - `interface BrainMask { width: number; height: number; data: Uint8Array }` (1 = brain, row-major)
  - `buildBrainMask(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, whiteMin = 230): BrainMask`. A pixel is background when it's white (all of r, g, b ≥ `whiteMin`) and 4-connected to a white pixel on the image border. Everything else is brain, including outline strokes and enclosed white areas.
  - `isBrain(mask: BrainMask, x: number, y: number): boolean`. Takes native px and floors them. Off-image is `false`.
  - `findCrossingPx(mask: BrainMask, tipPx: Point, dir: Point, maxDistPx: number, stepPx = 0.5): number | null`. `dir` is a unit vector. Returns the distance from the tip to the first sample that isn't brain. Returns `null` when the tip isn't brain, or when no exit is found within `maxDistPx`.

- [ ] **Step 1: Write the failing tests.** Use a helper `img(rows: string[])`: `"#"` is a black pixel, `"."` is white. It returns `{ rgba, width, height }`.
  - `buildBrainMask` on a 7×7 ring of `#` with a white inside: the ring and its inside are brain, the corners outside are not.
  - A ring with a one-pixel gap to the outside: the inside is **not** brain. Background reaches it.
  - Pinned for Review Focus 4: a closed shape whose wall includes a 1-px diagonal stroke (`#` only corner-touching) keeps its inside as brain. A 4-connected flood must not slip through the diagonal.
  - `isBrain` is `false` at (−1, 0) and at (width, 0).
  - `findCrossingPx` on a 9×9 image with the ring on rows/columns 1..7, tip `{4.5, 4.5}`, `dir {x:1,y:0}`: the result is between 3 and 4. The first non-brain sample is at x = 8.
  - `findCrossingPx` with the tip outside the brain returns `null`.
  - `findCrossingPx` with `maxDistPx` smaller than the distance to the wall returns `null`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/lib/brainMask.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/brainMask.ts`.** Use an iterative flood fill with a typed-array stack, not recursion, because the images are up to about 1500 × 900.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/brainMask.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/brainMask.ts src/lib/brainMask.test.ts
git commit -m "Add brain mask and shaft crossing detection"
```

---

### Task 3: Six views, noisy state and "last contact in brain"

**Files:**
- Modify: `src/types.ts:18-38`
- Modify: `src/lib/axialViews.ts`
- Modify: `src/lib/axial.ts`
- Modify: `src/lib/axialStyle.ts`
- Modify: `src/pages/AxialView.tsx` (drop the `caption` and `SCHEMATIC_NOTE` uses only, so the build stays green)
- Test: `src/lib/axial.test.ts`

**Interfaces:**
- Consumes: the Task 1 table, for the `mmPerPx` of the new views.
- Produces:
  - `type Tissue = "grey" | "white" | "noisy" | "outside"`
  - `type AxialViewId = "inferior" | "superior" | "leftLateral" | "leftMedial" | "rightLateral" | "rightMedial"`
  - `AxialPlacement` gains:
    - `lastInBrain?: number`: the last contact inside the brain, 1..contacts. Absent means all in brain.
    - `edgeDist?: number`: a hand-set brain-edge distance from the tip, in the view's native px.
  - `AxialViewConfig`:
    - removes `caption`;
    - adds `kind: "axial" | "sagittal"`, `fileSlug: string` (`bottom-up`, `top-down`, `left-lateral`, `left-medial`, `right-lateral`, `right-medial`), `hemisphere?: "L" | "R"` (sagittal only), `counterpart?: AxialViewId` (sagittal only: leftLateral↔rightLateral, leftMedial↔rightMedial) and `margin: { x: number; y: number }` (axial `{0.2, 0.06}` as today; sagittal `{0.15, 0.35}`);
    - for sagittal views, `midlineX` is unused (set it to `width / 2`), and `patientLeftOnViewerLeft` is `hemisphere === "L"`.
  - `AXIAL_VIEW_ORDER: AxialViewId[]`, in the order: inferior, superior, leftLateral, leftMedial, rightLateral, rightMedial.
  - `viewPickerOrder(hemisphere: Hemisphere | null): AxialViewId[]`. Gives inferior and superior, then the electrode's own side's lateral and medial, then the other side's. `null` follows `AXIAL_VIEW_ORDER`.
  - `TISSUE_ORDER` (and `TISSUE_KEY_ORDER`): `["grey", "white", "noisy", "outside"]`
  - `nextTissue(t: Tissue, allowOutside: boolean): Tissue`. With outside allowed: grey→white→noisy→outside→grey. Without: grey→white→noisy→grey, and `outside`→white (it is read as grey first).
  - `effectiveTissue(p: AxialPlacement): Tissue[]`. When `lastInBrain` = N is set: contacts above N read `outside`, and any stored `outside` at contacts 1..N reads `grey`. When it isn't set, the stored marks are returned unchanged.
  - `cycleContact(p, index)`. With N set: `index ≥ N` is a no-op; otherwise the effective state is cycled with `allowOutside = false`. Without N: as today, with `allowOutside = true`.
  - `setLastInBrain(p: AxialPlacement, n: number | undefined): AxialPlacement`. `undefined`, NaN or out of range removes the field; otherwise stores `round(n)`, clamped to 1..contacts.
  - `normalizeAxial`:
    - accepts the six views;
    - keeps `lastInBrain` only when it's a finite number, rounded and clamped to 1..contacts;
    - keeps `edgeDist` only when finite and > 0;
    - reads unknown tissue as grey (`noisy` is now known).
  - `withContactCount(p, n)` clamps `lastInBrain` to the new count.
  - `defaultAxialPlacement(view, hemisphere, keep?: Pick<AxialPlacement, "contacts" | "tissue" | "lastInBrain">)`:
    - axial views: as today;
    - sagittal views: tip `{0.5, 0.55}`, toward `{0.5, 0.3}`;
    - `lastInBrain` is kept from `keep` and clamped; `edgeDist` is never carried across.
  - `mirrorAxial(p, view)`:
    - axial views: as today;
    - sagittal views: returns the placement on `view.counterpart` with x → `1 − x` for both tip and toward;
    - always keeps contacts, tissue, `lastInBrain` and `edgeDist`.
  - `formatTissueRanges(tissue)` follows the new `TISSUE_ORDER`, e.g. `grey 1–3, 6 · white 4–5 · noisy 7 · outside 13–15`.
  - `TISSUE_STYLE.noisy = { label: "Noisy / lost", fill: "#ffffff", stroke: "#222222", opacity: 1, cross: false, slash: true }`. Every `TissueStyle` gains `slash: boolean`. Delete `SCHEMATIC_NOTE`.

- [ ] **Step 1: Update the existing tests and add new ones in `src/lib/axial.test.ts`.** Add `kind: "axial", fileSlug: "", margin: {x:0.2,y:0.06}` to the `V` fixture and remove `caption`. Add a sagittal fixture `VL = { ...V, id: "leftLateral", kind: "sagittal", hemisphere: "L", counterpart: "rightLateral" }`.
  - `nextTissue("grey", true)` → white, `("white", true)` → noisy, `("noisy", true)` → outside, `("outside", true)` → grey. `("noisy", false)` → grey. `("outside", false)` → white.
  - `effectiveTissue({...p, contacts: 5, tissue: ["grey","outside","white","grey","noisy"], lastInBrain: 3})` → `["grey","grey","white","outside","outside"]`.
  - `effectiveTissue` without `lastInBrain` returns the stored marks unchanged, `outside` included (Review Focus 1).
  - With `lastInBrain: 3`, `cycleContact(…, 3)` returns an equal placement; `cycleContact(…, 0)` from grey gives white.
  - `withContactCount({...p5, lastInBrain: 12}, 8).lastInBrain` → 8 (Review Focus 3). `setLastInBrain(p5, 0)` → field absent. `setLastInBrain(p5, 2.6)` → 3.
  - `normalizeAxial`:
    - keeps `view: "rightMedial"`;
    - drops `lastInBrain: "x"` and `edgeDist: -4`;
    - an old-format placement (`view: "inferior"`, no new fields, `outside` marks) round-trips deep-equal (Review Focus 1).
  - `defaultAxialPlacement(VL, "L", {contacts: 15, tissue: [], lastInBrain: 12})` has tip `{0.5, 0.55}`, `lastInBrain` 12 and no `edgeDist` (Review Focus 5).
  - `mirrorAxial({...p, view: "leftLateral", tip: {x:0.3,y:0.4}, toward: {x:0.3,y:0.2}, lastInBrain: 2, edgeDist: 40}, VL)` → view `rightLateral`, tip `{0.7, 0.4}`, `lastInBrain` 2, `edgeDist` 40 (Review Focus 5).
  - `viewPickerOrder("R")` → `["inferior","superior","rightLateral","rightMedial","leftLateral","leftMedial"]`.
  - `formatTissueRanges(["grey","noisy","outside"])` → `"grey 1 · noisy 2 · outside 3"`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/lib/axial.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement the types, the configs and the `axial.ts` / `axialStyle.ts` changes above.**
  - Fill in the four sagittal configs:
    - `imageFile` is `view-<slug>.png`;
    - `width`/`height` come from Task 1;
    - `mmPerPx = BRAIN_LENGTH_MM / (outline_x1 − outline_x0)`, with a comment giving the measured extent;
    - `label` is "Left lateral", "Left medial", "Right lateral" or "Right medial".
  - In `AxialView.tsx`, remove the caption `<span>` and the `SCHEMATIC_NOTE` line only.

- [ ] **Step 4: Run the tests and type-check**

Run: `npx vitest run && npx tsc -b`
Expected: all tests PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/lib/axialViews.ts src/lib/axial.ts src/lib/axialStyle.ts src/lib/axial.test.ts src/pages/AxialView.tsx
git commit -m "Add six views, noisy contacts and last-contact-in-brain rules"
```

---

### Task 4: Per-electrode spacing fit

**Files:**
- Modify: `src/lib/axial.ts`
- Test: `src/lib/axial.test.ts`

**Interfaces:**
- Consumes: `BrainMask`, `findCrossingPx` (Task 2); `AxialPlacement.lastInBrain` / `edgeDist` (Task 3).
- Produces:
  - `interface SpacingFit { innerPx: number; outerPx: number; ratio: number; crossingPx: number | null; status: "nominal" | "fitted" | "shrunk" | "no-crossing" }`
  - `nominalSpacingPx(view: AxialViewConfig): number` (3.5 / mmPerPx)
  - `fitSpacing(a: { nominalPx: number; contacts: number; lastInBrain?: number; crossingPx: number | null }): SpacingFit`:
    - **N = `lastInBrain`, set and below `contacts`:**
      - no crossing (null or ≤ 0): `inner = outer = nominal`, status `"no-crossing"`;
      - otherwise: `inner = crossingPx / (N − 0.5)`, `outer = nominal`, status `"fitted"`.
    - **Otherwise:**
      - a crossing exists and `(contacts − 0.5) × nominal > crossingPx`: `inner = outer = crossingPx / (contacts − 0.5)`, status `"shrunk"`;
      - else: `inner = outer = nominal`, status `"nominal"`.
    - `ratio = inner / nominal`.
  - `contactDistancesPx(contacts: number, lastInBrain: number | undefined, fit: SpacingFit): number[]`. Contact *i* (0-based) sits at `i × inner` for `i ≤ N`, and at `N × inner + (i − N) × outer` beyond. With no N below `contacts`, every contact is at `i × inner`.
  - `shaftFit(p: AxialPlacement, view: AxialViewConfig, mask: BrainMask | null): SpacingFit`. The crossing is `p.edgeDist` when set; else `findCrossingPx(mask, tipPx, dirPx, maxDist)` when a mask is loaded, with `maxDist = (p.contacts + 2) × nominal`; else `null`. With no mask and no `edgeDist`, the status is `"nominal"`, not `"no-crossing"`, so no warning shows while the image is loading.
  - `contactPositions(p, view, fit?: SpacingFit): Point[]` and `handlePosition(p, view, fit?: SpacingFit): Point`. When `fit` is omitted, the nominal fit is used. The handle sits one `outerPx` past the last contact, or one `innerPx` past it when no contact is outside.
  - `edgePosition(p, view, fit): Point | null`: the normalized point at `fit.crossingPx` along the shaft, or `null`.
  - `OFF_SCALE_TOLERANCE = 0.25`; `isOffScale(fit: SpacingFit): boolean`, which is true when `status` is `fitted` or `shrunk` and `|ratio − 1| > 0.25`.

- [ ] **Step 1: Write the failing tests.** Use `nominalPx` = 10, as in fixture `V`.
  - `fitSpacing({nominalPx:10, contacts:15, lastInBrain:12, crossingPx:115})` gives `innerPx` 10, `outerPx` 10, status `"fitted"`. Also with `crossingPx:92` it gives inner 8 and ratio 0.8.
  - `fitSpacing({…, lastInBrain:12, crossingPx:null})` gives status `"no-crossing"`, inner 10 (Review Focus 2).
  - `fitSpacing({nominalPx:10, contacts:10, crossingPx:200})` gives `"nominal"`. With `crossingPx:76` it gives `"shrunk"`, inner 8.
  - `fitSpacing({…, contacts:10, lastInBrain:10, crossingPx:76})` behaves exactly like no `lastInBrain`.
  - `contactDistancesPx(15, 2, {innerPx:20, outerPx:10, …})` → `[0, 20, 40, 50, 60, …]`. The value at index 14 is 160.
  - `contactPositions(p, V)` with no fit still equals today's positions (the existing tests stay unchanged; Review Focus 1).
  - `shaftFit` on fixture `V` with a synthetic mask (a 400×500 rectangle of brain, from x 50 to x 350, brain = 1 inside) and `p` tip `{0.25, 0.5}` pointing to `x=0`, `contacts: 10`, `lastInBrain: 3`: `crossingPx` is ≈ 50, inner ≈ 20.
  - The same placement with the tip at `{0.05, 0.5}` (outside the brain) gives status `"no-crossing"` (Review Focus 2).
  - With `edgeDist: 25`, `crossingPx` is 25 and the mask is ignored.
  - `shaftFit(p, V, null)` gives status `"nominal"`.
  - `isOffScale` is true for ratio 0.7 with status `fitted`, false for ratio 0.8, and false for `no-crossing`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/lib/axial.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement the functions above in `src/lib/axial.ts`.** `alongShaft` takes a distance in px instead of a number of steps.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/axial.ts src/lib/axial.test.ts
git commit -m "Fit contact spacing to the outline per electrode"
```

---

### Task 5: Electrode view page, canvas and side list

**Files:**
- Create: `src/lib/useBrainMask.ts`
- Modify: `src/components/AxialCanvas.tsx`
- Modify: `src/components/AxialElectrodeList.tsx`
- Modify: `src/pages/AxialView.tsx`
- Modify: `src/App.tsx:46` (tab label "Electrode view")

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `useBrainMask(viewId: AxialViewId): BrainMask | null`. Loads `axialImageUrl(viewId)` into an `Image`, draws it on a canvas, `getImageData`, then `buildBrainMask`. Results are cached in a module-level `Map<AxialViewId, Promise<BrainMask>>`. Returns null until ready.
  - `AxialCanvas({ viewId, showAllNumbers })`, unchanged props. Anything that must not appear in exports carries `className="edit-only"`: the ◆ rotate handle and the edge bar.
  - The `AxialView` page keeps one `ref` per view wrapper, as `Record<AxialViewId, HTMLDivElement | null>`. Task 6 captures them.

- [ ] **Step 1: Write `useBrainMask`.** Also expose `maskCoverage(mask): number`, the fraction of brain pixels, for the verification step.

- [ ] **Step 2: Rework `AxialCanvas`.**
  - The frame comes from `view.margin`.
  - Each `Shaft` uses `shaftFit(placement, view, mask)` for `contactPositions`, `handlePosition` and `effectiveTissue`.
  - All drawing sizes are in mm via `mm(v) = v / view.mmPerPx`, so lateral/medial images (about 1500 px wide) look like the axial ones. The current px values become mm by multiplying by 0.331:
    - stroke 1.8 px → 0.6 mm;
    - name font 11 px → 3.6 mm;
    - number font 6.5 px → 2.15 mm;
    - side-marker font 22 px → 7.3 mm.
  - Dot radius is `min(0.36 × nominalPx, 0.45 × innerPx)`. The hit-area radius is `0.5 × innerPx`.
  - Noisy dots draw a diagonal slash through the circle, extending slightly past it (⊘) in the style's stroke colour.
  - `SideMarkers`: axial views as today. Sagittal views show one `view.hemisphere` letter at the top-left of the frame.
  - **Edge bar:** a short bar across the shaft at `edgePosition(...)`, drawn only when `lastInBrain` is below `contacts`. Dragging it projects the pointer onto the shaft direction and stores `edgeDist = max(0.25 × nominalPx, projection)` through `updateElectrode` inside a history batch. Its `<title>` reads "Drag to set where the brain edge is".
  - Contact clicks call the Task 3 `cycleContact`.

- [ ] **Step 3: Rework `AxialElectrodeList` rows.**
  - The view `<select>` lists Off plus `viewPickerOrder(hemisphereOf(e.name))`.
  - Switching view passes `keep` with `lastInBrain` (Task 3 drops `edgeDist`).
  - Under the contact count, add a **"Last in brain"** `<select>`. Its options are `All` (value "") and `1..contacts`, and it calls `setLastInBrain`.
  - The ranges text uses `formatTissueRanges(effectiveTissue(p))`.
  - A fit line:
    - `status` fitted/shrunk: `"Scale {round(ratio×100)}%"`;
    - `isOffScale`: `"⚠ {pct}% of true scale. Try another view or check the tip"`;
    - `no-crossing`: `"⚠ Brain edge not found; standard spacing"`.
  - When `edgeDist` is set, a small **Reset edge** button sets it to `undefined`.
  - The row uses `useBrainMask(placement.view)`.

- [ ] **Step 4: Rework the `AxialView` page.**
  - Show only the views in use, in `AXIAL_VIEW_ORDER`, in a CSS grid (`repeat(auto-fit, minmax(420px, 1fr))`).
  - No titles, captions or note.
  - When nothing is placed, show the empty-state text "Choose a view for an electrode in the list to show it here."
  - Toolbar hint: "Click a contact: grey → white → noisy. Set "Last in brain" in the list. Drag to move, ◆ to rotate, the edge bar to adjust the brain edge."
  - Rename the tab in `App.tsx`.

- [ ] **Step 5: Type-check and run the tests**

Run: `npx tsc -b && npx vitest run`
Expected: no errors, PASS.

- [ ] **Step 6: Verify in the browser.** Use `preview_start` (add a `.claude/launch.json` entry `npm run dev`, port 5173, if missing). Load a plan with a few depth electrodes: either a `.seegmap` from Home, or electrodes added in the Planner.
  - Each view appears only once an electrode is placed on it, and disappears when its last electrode is set to Off.
  - **Mask coverage (Review Focus 4):** in the console, for each of the six views, check `maskCoverage` is between 0.35 and 0.9. A value near 0 means the background leaked into the brain.
  - An electrode with 15 contacts and "Last in brain" 12, tip on the amygdala on bottom-up: contacts 13–15 show ✕, contact 12 sits just inside the outline, contact 13 just outside, and the scale shows close to 100%.
  - The same electrode rotated to point inward into the brain shows the "Brain edge not found" warning.
  - Dragging the edge bar moves the in-brain contacts; **Reset edge** restores them.
  - A left lateral placement mirrored with Planner "Mirror to R/L" appears on right lateral.
  - The noisy ⊘ dot is visible.
  - Take a screenshot as proof.

- [ ] **Step 7: Commit**

```bash
git add src/lib/useBrainMask.ts src/components/AxialCanvas.tsx src/components/AxialElectrodeList.tsx src/pages/AxialView.tsx src/App.tsx
git commit -m "Electrode view: six views, last-in-brain dropdown and fitted shafts"
```

---

### Task 6: Per-view PNG export with legend

**Files:**
- Modify: `src/lib/export/capture.ts` (`captureNode` gains an optional `filter`)
- Modify: `src/lib/export/axialLegend.ts`
- Create: `src/lib/export/electrodeViewPng.ts`
- Modify: `src/pages/AxialView.tsx` (`runExport`)
- Test: `src/lib/export/axialLegend.test.ts`

**Interfaces:**
- Consumes:
  - `effectiveTissue`, `formatTissueRanges`, `TISSUE_STYLE`, `TISSUE_KEY_ORDER` (Task 3);
  - `LegendTable` (`./legend`);
  - `canvasToPngWithDpi`, `downloadBlob`, `exportBaseName` (`./png`);
  - `trimWhitespace`, `loadImage` (`./legend`);
  - the view refs (Task 5).
- Produces:
  - `captureNode(node, pixelRatio = 2, filter?: (n: HTMLElement) => boolean)`, passed through to `toPng`.
  - `axialLegendEntries(all: Electrode[], viewId?: AxialViewId): AxialLegendEntry[]`. When `viewId` is given, only electrodes on that view are included. Ranges come from `effectiveTissue`.
  - `measureTissueKey(u: number): { width: number; height: number }` and `drawTissueKey(ctx, x, y, u): void`, refactored out of `exportAxialLegendPng`. `drawTissueDot` draws the noisy slash.
  - `buildLegendCanvasParts(entries, u)`: the shared table + key layout used by both PNG kinds. Name and shape are the builder's choice, as long as both exports share it.
  - `exportElectrodeViewPng(node: HTMLElement, entries: AxialLegendEntry[], filename: string): Promise<void>`:
    - capture `node` excluding `.edit-only` elements, at a pixel ratio that makes the figure 1600 px wide;
    - `trimWhitespace`;
    - draw the figure with that view's legend table and the four-state key **below** it, 40 px gap, 48 px padding, white background;
    - save at 300 dpi via `canvasToPngWithDpi` + `downloadBlob`.
  - `exportAxialLegendPng`, unchanged signature: the combined legend of all placed electrodes, with the four-state key.

- [ ] **Step 1: Write the failing tests in `axialLegend.test.ts`.**
  - With electrodes on `inferior` and `leftLateral`, `axialLegendEntries(all, "leftLateral")` returns only the lateral one, and its letter still matches the whole-plan order.
  - An entry with `lastInBrain: 2` on tissue `["grey","white","grey"]` gives ranges `"grey 1 · white 2 · outside 3"`.
  - The existing tests are unchanged and pass.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/lib/export/axialLegend.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement the interfaces above.** In `runExport`, for each view in use:
  - save `exportElectrodeViewPng(ref, axialLegendEntries(electrodes, v), \`${base}-${AXIAL_VIEWS[v].fileSlug}\`)`;
  - then save `exportAxialLegendPng(electrodes, \`${base}-electrode-legend\`)`;
  - then alert with every file name and the existing multiple-downloads hint.

  The captured node is the view's SVG wrapper without its on-screen border. Move the border onto an outer wrapper.

- [ ] **Step 4: Run the tests and type-check**

Run: `npx vitest run && npx tsc -b`
Expected: PASS, no errors.

- [ ] **Step 5: Verify the export in the browser.** Before clicking **Export PNG**, use `javascript_tool` to wrap `HTMLAnchorElement.prototype.click` so it records `this.download` and `this.href` instead of downloading. Then click **Export PNG**.
  - One file per view in use plus `-electrode-legend.png`, with the expected names.
  - Open one view blob in a new tab and screenshot it. It has the outline, L/R marker(s), names, dots, the legend table for that view only and the four-state key. It has no ◆ handle, no edge bar, no title and no note.
  - No console errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/export/capture.ts src/lib/export/axialLegend.ts src/lib/export/electrodeViewPng.ts src/lib/export/axialLegend.test.ts src/pages/AxialView.tsx
git commit -m "Export each Electrode view as its own PNG with legend"
```

---

### Task 7: README and final check

**Files:**
- Modify: `README.md` (section "Mark contacts on the Axial view")

- [ ] **Step 1: Rewrite the README section** as "Mark contacts on the Electrode view". It covers:
  - the post-implant purpose;
  - the six views, with only views in use shown;
  - the four states and the click cycle;
  - the "Last in brain" dropdown and how it fits the shaft (outside contacts beyond the first at 3.5 mm);
  - the scale percentage and its ±25% warning;
  - the edge bar and Reset edge;
  - the medial views using the Planner's arrangement;
  - one PNG per view with its legend, plus `-electrode-legend.png`;
  - placements saving with the plan and Mirror to R/L.

  Remove the "schematic" paragraph.

- [ ] **Step 2: Full check**

Run: `npm run build && npx vitest run`
Expected: build succeeds, all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document the Electrode view"
```
