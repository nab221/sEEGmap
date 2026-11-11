# Axial Contact View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Axial view" page that shows each depth electrode's full shaft, contact by contact, on a bottom-up or top-down brain outline. The user marks each contact as grey matter, white matter or outside the brain, and the page exports a figure PNG plus a separate legend PNG.

**Architecture:** An optional `axial` placement is stored on each electrode, so it rides the existing autosave, `.seegmap`, undo/redo and mirror paths. All geometry and tissue logic lives in the pure, unit-tested `src/lib/axial.ts`. The new page uses `updateElectrode` with those helpers and needs no new store actions. Exports reuse the A4/300 dpi PNG pipeline and a generalised `LegendTable`.

**Tech Stack:** React 18 + TypeScript + Vite 5, Zustand, Dexie, SVG, html-to-image, canvas. Adds **vitest 2.1.9** (dev only) for the pure library.

**Spec:** `docs/superpowers/specs/2026-11-11-axial-contact-view-design.md`

## Global Constraints

- Contact spacing **3.5 mm** centre to centre; one constant for the whole page (`CONTACT_SPACING_MM = 3.5`).
- Contact 1 = the tip = the deepest contact; contacts run outward from the tip. The number of dots drawn always equals `contacts`.
- Tissue cycle on click: `grey → white → outside → grey`. New contacts start `"grey"`.
- Default contact count on first placement: **10**. Allowed range: **1–24**.
- Both outlines have anterior at the top. Superior (top-down): patient's left = viewer's **left**. Inferior (bottom-up): patient's left = viewer's **right**. Each outline shows **L** and **R** markers and a "from below" or "from above" caption.
- Shafts are drawn at full length (a schematic). The page shows this note, and the exported figure includes it in small print: *"Schematic: shafts drawn at full length with 3.5 mm contact spacing, as if level in the axial plane."*
- Grid/strip electrodes (`type: "grid"`) never appear on this page.
- Legend letters equal the Planner legend's letters: `electrodeLetter(index in all electrodes sorted by order)`.
- Export file names: `<base>-axial.png` and `<base>-axial-legend.png`, where `<base>` is computed exactly as the Planner's `baseFilename()` does (patient label with spaces turned into `_`, or `seegmap_export`).
- Old plans and sessions without `axial` must load unchanged.
- Work on branch `axial-view` (not `main`).

## Review Focus

1. **Malformed or old `axial` data** (from a hand-edited `.seegmap` or an older build, e.g. `tissue` shorter than `contacts`, a `contacts` value that isn't a number, an unknown tissue string). It should render and export without crashing, repaired to sane values. Covered by `normalizeAxial` tests in Task 2; rendering and legend call it.
2. **Tip and direction handle on the same point** (zero-length direction). The shaft should still draw, pointing away from the midline. Covered by a `contactPositions` test in Task 2.
3. **A click that jitters by a pixel or two.** It should count as a click that cycles tissue, not a drag. A 4-CSS-px threshold in Task 3, verified in the browser.
4. **Second download blocked by the browser** ("allow multiple downloads"). Both files should still arrive, or the user should see a message. Task 4 starts the second download after the first and shows an alert naming both files; verified in the browser.
5. **A non-contiguous, single-contact or all-one-state electrode** in the legend text. It should read naturally: `grey 1–3, 6 · white 4–5 · outside 7`, `white 1`, `grey 1–10`. Covered by `formatTissueRanges` tests in Task 2.

---

## File structure

| File | Responsibility |
|---|---|
| `public/axial-inferior.png`, `public/axial-superior.png` (create) | Outline art supplied by the user |
| `src/types.ts` (modify) | `Tissue`, `AxialViewId`, `AxialPlacement`, `axial?` on `BaseElectrode` |
| `src/lib/axialViews.ts` (create) | Per-view config: image, size, midline, scale, captions, side mapping |
| `src/lib/axial.ts` (create) | Pure geometry and tissue helpers |
| `src/lib/axial.test.ts` (create) | Unit tests for `axial.ts` |
| `src/components/AxialCanvas.tsx` (create) | One outline with its shafts, contacts, handles and pointer interaction |
| `src/components/AxialElectrodeList.tsx` (create) | Side list: view picker, contact count, tissue summary per electrode |
| `src/pages/AxialView.tsx` (create) | Page layout, undo/redo keys and buttons, toggle, export button |
| `src/App.tsx` (modify) | Route `/axial` and nav tab "Axial view" |
| `src/lib/export/legend.ts` (modify) | `LegendTable` options: `letterFor`, `extraColumn` |
| `src/lib/export/png.ts` (modify) | Export `canvasToPngWithDpi`, `downloadBlob`, `exportBaseName` |
| `src/lib/export/axialLegend.ts` (create) | Legend PNG with tissue-ranges column and dot-style key |
| `src/store/useStore.ts` (modify) | `mirrorElectrode` carries a mirrored `axial` |
| `src/pages/Planner.tsx` (modify) | Use shared `exportBaseName` |
| `README.md` (modify) | Document the Axial view |

---

### Task 1: Branch, test runner, types, view config and assets

**Files:**
- Create: `public/axial-inferior.png`, `public/axial-superior.png`, `src/lib/axialViews.ts`
- Modify: `src/types.ts`, `package.json`

**Interfaces:**
- Produces (in `src/types.ts`):
  ```ts
  export type Tissue = "grey" | "white" | "outside";
  export type AxialViewId = "inferior" | "superior";
  export interface AxialPlacement {
    view: AxialViewId;
    tip: Point;      // normalised 0..1 on that view's image; contact 1
    toward: Point;   // any point outward along the shaft; only its direction matters
    contacts: number; // 1..24
    tissue: Tissue[]; // length === contacts; index 0 = contact 1
  }
  // on BaseElectrode:
  axial?: AxialPlacement;
  ```
- Produces (in `src/lib/axialViews.ts`):
  ```ts
  export interface AxialViewConfig {
    id: AxialViewId;
    label: string;          // "Bottom-up" | "Top-down"
    caption: string;        // "from below" | "from above"
    imageFile: string;      // relative to public/
    width: number;          // native px
    height: number;         // native px
    midlineX: number;       // native px
    mmPerPx: number;        // 170 / (outline bottom y − outline top y)
    patientLeftOnViewerLeft: boolean; // superior: true, inferior: false
  }
  export const AXIAL_VIEWS: Record<AxialViewId, AxialViewConfig>;
  export const AXIAL_VIEW_ORDER: AxialViewId[]; // ["inferior", "superior"]: bottom-up shown first
  export function axialImageUrl(id: AxialViewId): string; // `${import.meta.env.BASE_URL}${imageFile}`
  ```

- [ ] **Step 1: Create the branch and commit the spec.**
  Run: `git checkout -b axial-view && git add docs/superpowers && git commit -m "Add axial contact view design and plan"`

- [ ] **Step 2: Copy the assets.** The user's images are in this session's paste folder:
  `/private/tmp/claude-501/-Users-anderson-Codes-sEEGmap/cf8000fc-3d54-4a25-a840-da827652aa0d/images/1.png` → `public/axial-superior.png` (top-down, 452 × 603)
  `/private/tmp/claude-501/-Users-anderson-Codes-sEEGmap/cf8000fc-3d54-4a25-a840-da827652aa0d/images/2.png` → `public/axial-inferior.png` (bottom-up, 429 × 529)
  Remove the stray dark horizontal bar along the bottom of the superior image (around y ≈ 520, x ≈ 140–320) by cropping or painting white. Use `sips` or a canvas script in the browser preview; PIL is not installed. View the result with the Read tool: the outline is intact and the bar is gone.

- [ ] **Step 3: Measure each image.** Measure the native width/height, the outline's top and bottom y, and the midline x (the interhemispheric fissure). For example, load each image in the browser preview and scan dark pixels with `javascript_tool`. Expected roughly: superior midline ≈ 222 and outline height ≈ 520 px; inferior midline ≈ 215 and outline height ≈ 520 px, giving `mmPerPx` ≈ 0.33.

- [ ] **Step 4: Add the types to `src/types.ts`** exactly as in Interfaces.

- [ ] **Step 5: Write `src/lib/axialViews.ts`** with the measured values. Label the superior view "Top-down" / "from above" with `patientLeftOnViewerLeft: true`, and the inferior view "Bottom-up" / "from below" with `false`.

- [ ] **Step 6: Add vitest.**
  Run: `npm install -D vitest@2.1.9` and add the script `"test": "vitest run"` to `package.json`.

- [ ] **Step 7: Verify the build.**
  Run: `npm run build`. Expected: no type errors.

- [ ] **Step 8: Commit.**
  `git add public/axial-*.png src/types.ts src/lib/axialViews.ts package.json package-lock.json && git commit -m "Add axial view types, view config and outline images"`

---

### Task 2: Pure axial library (TDD)

**Files:**
- Create: `src/lib/axial.ts`, `src/lib/axial.test.ts`

**Interfaces:**
- Consumes: `AxialPlacement`, `Tissue`, `AxialViewId`, `Point` from `src/types.ts`; `AxialViewConfig` from `src/lib/axialViews.ts`.
- Produces (all in `src/lib/axial.ts`):
  ```ts
  export const CONTACT_SPACING_MM = 3.5;
  export const DEFAULT_CONTACTS = 10;
  export const MIN_CONTACTS = 1;
  export const MAX_CONTACTS = 24;
  export type Hemisphere = "L" | "R";
  export function hemisphereOf(name: string): Hemisphere | null;        // leading L/R, case-insensitive
  export function nextTissue(t: Tissue): Tissue;                        // grey→white→outside→grey
  export function resizeTissue(tissue: Tissue[], n: number): Tissue[];  // clamps n to 1..24, keeps prefix, pads "grey"
  export function normalizeAxial(p: AxialPlacement): AxialPlacement;   // repairs contacts (non-finite → 10, clamp, round) and tissue (unknown → "grey", length = contacts)
  export function withContactCount(p: AxialPlacement, n: number): AxialPlacement;
  export function cycleContact(p: AxialPlacement, index: number): AxialPlacement; // index 0-based; out of range → unchanged
  export function contactPositions(p: AxialPlacement, view: AxialViewConfig): Point[]; // normalised; [0] = tip
  export function handlePosition(p: AxialPlacement, view: AxialViewConfig): Point;     // one spacing beyond the last contact
  export function translateAxial(p: AxialPlacement, dx: number, dy: number): AxialPlacement; // moves tip and toward; tip clamped to 0..1
  export function defaultAxialPlacement(
    view: AxialViewConfig,
    hemisphere: Hemisphere | null,
    keep?: Pick<AxialPlacement, "contacts" | "tissue">
  ): AxialPlacement;
  export function mirrorAxial(p: AxialPlacement, view: AxialViewConfig): AxialPlacement; // x' = 2·(midlineX/width) − x, clamped
  export function formatTissueRanges(tissue: Tissue[]): string;
  ```
- Notes on behaviour the tests don't fully pin:
  - **Geometry works in native pixels:** the direction is `(toward − tip)` scaled by `(width, height)`, then normalised. Contact *i* sits at `tip + dir · i · (CONTACT_SPACING_MM / mmPerPx)` px, converted back to 0..1. Do **not** clamp contact positions, because contacts past the outline (or the image edge) are the point.
  - **Zero-length direction:** point horizontally away from the midline. If the tip is exactly on the midline, point to the viewer's left.
  - **`defaultAxialPlacement`:** puts the tip at `y = 0.5`, a distance of `0.2·width` px from the midline, on the viewer side for that hemisphere. With `patientLeftOnViewerLeft`, `L` goes to the viewer's left, otherwise to the viewer's right; `null` goes to the viewer's left. `toward` is `0.1·width` further out on the same side. The view comes from `view.id`. `contacts` and `tissue` come from `keep` (normalised) or the defaults `10` × `"grey"`.

- [ ] **Step 1: Write the failing tests in `src/lib/axial.test.ts`.** Use this fixture:
  `const V = { id: "superior", label: "", caption: "", imageFile: "", width: 400, height: 500, midlineX: 200, mmPerPx: 0.35, patientLeftOnViewerLeft: true } as AxialViewConfig;` (spacing = 10 px), plus `const VI = { ...V, id: "inferior", patientLeftOnViewerLeft: false }`.
  ```ts
  // contactPositions: horizontal shaft
  const p = { view: "superior", tip: { x: 0.25, y: 0.5 }, toward: { x: 0, y: 0.5 }, contacts: 3, tissue: ["grey","grey","grey"] };
  expect(contactPositions(p, V)).toEqual([{ x: 0.25, y: 0.5 }, { x: 0.225, y: 0.5 }, { x: 0.2, y: 0.5 }]); // toBeCloseTo per coord
  // contactPositions: diagonal on a non-square image keeps 10 px spacing
  //   tip {0.5,0.5}, toward {0.6,0.58} → px distance between consecutive contacts ≈ 10 (toBeCloseTo 6)
  // contactPositions: count matches contacts, and is not clamped past the image edge
  //   tip {0.02,0.5}, toward {0,0.5}, contacts 5 → length 5, last x < 0
  // contactPositions: zero-length direction on the viewer-left half points left
  //   tip = toward = {0.3,0.5} → second contact x < 0.3
  // handlePosition: one spacing past the last contact → {x: 0.175, y: 0.5} for p above
  // nextTissue cycles grey→white→outside→grey
  // resizeTissue(["white","outside"], 4) → ["white","outside","grey","grey"]
  // resizeTissue(["white","outside"], 1) → ["white"];  (x, 0) → length 1;  (x, 30) → length 24
  // normalizeAxial({...p, contacts: 3, tissue: ["white", "bogus" as Tissue]}).tissue → ["white","grey","grey"]
  // normalizeAxial({...p, contacts: NaN}).contacts → 10
  // cycleContact(p, 1).tissue → ["grey","white","grey"]; cycleContact(p, 9) → equal to p
  // withContactCount(p with tissue ["outside","white","grey"], 2).tissue → ["outside","white"]
  // defaultAxialPlacement(V, "L").tip.x < 0.5  and  .toward.x < .tip.x  and  .contacts === 10, all tissue "grey"
  // defaultAxialPlacement(VI, "L").tip.x > 0.5 and  .toward.x > .tip.x  and  .view === "inferior"
  // defaultAxialPlacement(V, "R").tip.x > 0.5;  defaultAxialPlacement(V, null).tip.x < 0.5
  // defaultAxialPlacement(V, "L", { contacts: 3, tissue: ["white","white","outside"] }) keeps both
  // mirrorAxial(p, V).tip.x ≈ 0.75, .toward.x ≈ 1.0, tissue and contacts unchanged
  // mirrorAxial(p, { ...V, midlineX: 210 }).tip.x ≈ 0.8
  // translateAxial(p, 0.1, -0.1) → tip {0.35, 0.4}, toward {0.1, 0.4}
  // hemisphereOf("LTMI") → "L"; ("rpf") → "R"; ("XYZ") → null; ("") → null
  // formatTissueRanges(["grey","grey","grey","white","white","grey","outside"]) → "grey 1–3, 6 · white 4–5 · outside 7"
  // formatTissueRanges(Array(10).fill("grey")) → "grey 1–10"
  // formatTissueRanges(["white"]) → "white 1";  ([]) → ""
  ```
  The dash in ranges is an en dash (`–`, U+2013); the separator between states is `" · "`, and states always appear in the order grey, white, outside.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `npm test`. Expected: FAIL (module `./axial` has no exports).

- [ ] **Step 3: Implement `src/lib/axial.ts`** with the signatures above.

- [ ] **Step 4: Run the tests and confirm they pass.**
  Run: `npm test`. Expected: all pass. Then run `npm run build` and expect no type errors.

- [ ] **Step 5: Commit.**
  `git add src/lib/axial.ts src/lib/axial.test.ts && git commit -m "Add axial contact geometry and tissue helpers"`

---

### Task 3: Axial view page (canvas, list, route)

**Files:**
- Create: `src/components/AxialCanvas.tsx`, `src/components/AxialElectrodeList.tsx`, `src/pages/AxialView.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: everything from Task 2; `AXIAL_VIEWS`, `AXIAL_VIEW_ORDER`, `axialImageUrl` from Task 1; the store's `electrodes`, `updateElectrode(id, patch)`, `beginHistoryBatch()`, `endHistoryBatch()`, `undo()`, `redo()`, `undoStack`, `redoStack`; `electrodeLetter` from `src/lib/nomenclature.ts`.
- Produces:
  ```ts
  // src/components/AxialCanvas.tsx
  export default function AxialCanvas(props: { viewId: AxialViewId; showAllNumbers: boolean }): JSX.Element;
  // src/components/AxialElectrodeList.tsx
  export default function AxialElectrodeList(): JSX.Element;
  // src/pages/AxialView.tsx
  export default function AxialView(): JSX.Element;
  ```
  `AxialView` holds the element to capture in a ref (`figureRef`) that Task 4 passes to the export. That element contains both canvases, their captions, L/R markers and the schematic note, and nothing else.

- [ ] **Step 1: Route and nav.** In `src/App.tsx`, add `<Route path="/axial" element={<AxialView />} />` and a `NavTab to="/axial"` labelled **"Axial view"** between Planner and Settings.

- [ ] **Step 2: `AxialCanvas`.**
  - The SVG `viewBox` is `0 0 width height` in the view's native px, with `preserveAspectRatio="none"` inside a container of matching `aspectRatio`, the same pattern as `BrainCanvas`. The outline is an `<image>` filling the viewBox.
  - Markers are **L** and **R** at the left and right edges, by `patientLeftOnViewerLeft`. The caption reads `"${label} (${caption})"`, for example "Bottom-up (from below)".
  - Draw every non-grid electrode whose `axial?.view === viewId`, in plan order. Pass the placement through `normalizeAxial` first.
  - Each shaft is a line in the electrode colour from the tip to the last contact. Draw the contacts on top. Keep the dot radius ≤ 0.4 × the spacing in px so neighbouring dots don't touch.
    - grey: fill `#555`, no stroke
    - white: fill `#fff`, stroke `#222`
    - outside: no fill, stroke `#999` at reduced opacity, with a small ✕ inside
  - The direction handle is a small diamond at `handlePosition`. The electrode name goes in the electrode colour, beyond the handle along the shaft direction.
  - Contact numbers go on contact 1 and the last contact, or on all contacts when `showAllNumbers` is on.
  - **Pointer:**
    - Pointer-down on a contact or the shaft records the start position and calls `beginHistoryBatch()`.
    - Once the pointer has moved ≥ 4 CSS px, it's a drag: `translateAxial` by the normalised delta through `updateElectrode`.
    - On pointer-up with no drag, it's a click on a contact: `updateElectrode(id, { axial: cycleContact(p, i) })`.
    - Pointer-down on the handle starts a rotate drag that sets `toward` to the pointer position.
    - Every pointer-up calls `endHistoryBatch()`, so one drag or one click is one undo step.
    - Convert screen coordinates with `getBoundingClientRect`, as `BrainCanvas.clientToNormalized` does.

- [ ] **Step 3: `AxialElectrodeList`.** Show one row per non-grid electrode in plan order:
  - the letter (from the full sorted list, including grids, as in `ElectrodePanel`), a colour dot and the name;
  - a `<select>` with **Off / Bottom-up / Top-down**;
  - a number input for contacts (1–24), disabled when Off;
  - a line showing `formatTissueRanges` for placed electrodes.

  How the controls behave:
  - Choosing a view sets `axial` to `defaultAxialPlacement(AXIAL_VIEWS[v], hemisphereOf(e.name), e.axial)`, which keeps the contact count and marks when switching views.
  - Choosing Off sets `axial: undefined`.
  - The contacts input calls `withContactCount`.

  With no non-grid electrodes, show "Add depth electrodes in the Planner first." and a link to `/planner`.

- [ ] **Step 4: `AxialView` page.**
  - Layout: the list on the right, like the Planner panel, and the two canvases side by side in `figureRef` (bottom-up first, per `AXIAL_VIEW_ORDER`). Below them, the schematic note in small muted text, inside `figureRef`.
  - Toolbar: Undo and Redo buttons (disabled when their stack is empty), a "Show all contact numbers" checkbox (page state, default off), and an "Export PNG" button that Task 4 wires up (disabled for now).
  - Keyboard: Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo; ignored while focus is in an input, textarea or select. Same logic as in `Planner.tsx`.

- [ ] **Step 5: Verify in the browser.** Start the dev server with `preview_start` (add a `vite` entry to `.claude/launch.json` if it's missing) and check each item:
  - With a plan containing `LTMI` and `RTAI`:
    - set `LTMI` → Bottom-up: its tip appears on the viewer's **right** half;
    - set `RTAI` → Top-down: it appears on the viewer's **right** half;
    - set `LTMI` → Top-down: it moves to the viewer's **left** half.
  - Set contacts to 15: 15 dots, with the outer ones past the outline.
  - Click contacts: they cycle grey → white → outside → grey.
  - A drag moves the shaft without cycling a contact.
  - Dragging the handle rotates the shaft about the tip.
  - Ctrl+Z undoes one step at a time.
  - Reloading the page keeps everything (autosave).
  - Nothing in `read_console_messages` errors.
  - Run `npm run build` and `npm test`; both pass.

- [ ] **Step 6: Commit.**
  `git add src/components/AxialCanvas.tsx src/components/AxialElectrodeList.tsx src/pages/AxialView.tsx src/App.tsx && git commit -m "Add Axial view page for marking contacts along each shaft"`

---

### Task 4: Export figure PNG and separate legend PNG

**Files:**
- Modify: `src/lib/export/legend.ts`, `src/lib/export/png.ts`, `src/pages/Planner.tsx`, `src/pages/AxialView.tsx`
- Create: `src/lib/export/axialLegend.ts`

**Interfaces:**
- Consumes: `formatTissueRanges` and `normalizeAxial` from Task 2; `figureRef` from Task 3.
- Produces:
  ```ts
  // legend.ts: backwards-compatible; the Planner's calls are unchanged
  export interface LegendOptions {
    letterFor?: (e: Electrode, index: number) => string;           // default: electrodeLetter(index)
    extraColumn?: { header: string; cap: number; cell: (e: Electrode) => string }; // cap in CSS px
  }
  constructor(electrodes: Electrode[], u: number, options?: LegendOptions);
  // png.ts
  export function canvasToPngWithDpi(canvas: HTMLCanvasElement, dpi: number): Promise<Blob>; // now exported
  export function downloadBlob(blob: Blob, filename: string): void; // the existing link-click + revoke logic, extracted
  export function exportBaseName(patientLabel: string): string;     // same rule as Planner's baseFilename()
  // axialLegend.ts
  export async function exportAxialLegendPng(allElectrodes: Electrode[], filename: string): Promise<void>;
  ```

- [ ] **Step 1: Generalise `LegendTable`.** Add `options` and an optional `"extra"` column (header from options, width capped at `cap * u`, appended after Target). When `letterFor` is given, the row letter comes from it. Check that the Planner PNG and PDF exports look unchanged in the browser.

- [ ] **Step 2: Refactor `png.ts`.** Export `canvasToPngWithDpi`, extract `downloadBlob`, add `exportBaseName`, and switch `Planner.tsx`'s `baseFilename` to `exportBaseName(patientLabel)`.

- [ ] **Step 3: Write `exportAxialLegendPng`.**
  - Rows: electrodes with `axial` set, excluding grids, in plan order.
  - Letters: `electrodeLetter(index in all electrodes sorted by order)`.
  - Extra column: header **"Contacts"**, cell `formatTissueRanges(normalizeAxial(e.axial).tissue)`, cap 320.
  - Size: `u = 300 / 96` (print size at 300 dpi), using `layoutForHeight(Infinity)` (a single table).
  - Below the table, a key row with three sample dots drawn the same way as `AxialCanvas` and labelled "Grey matter", "White matter" and "Outside brain".
  - Padding of 16·u on a white background. Encode with `canvasToPngWithDpi(canvas, 300)`, then `downloadBlob`.
  - If no electrode is placed, it does nothing; the page disables the button in that case.

- [ ] **Step 4: Wire up Export PNG on `AxialView`.**
  1. `await exportWorkspacePng(figureRef.current, \`${base}-axial\`)` with no legend argument.
  2. `await exportAxialLegendPng(electrodes, \`${base}-axial-legend\`)`.
  3. Show an alert: "Saved ${base}-axial.png and ${base}-axial-legend.png. If only one arrived, allow multiple downloads for this site and export again."

  Disable the button while busy and when no electrode is placed. On error, show the same "Export failed" alert as the Planner.

- [ ] **Step 5: Verify in the browser.**
  - Export with two placed electrodes: two downloads arrive, checked with `read_network_requests` or by inspecting the generated blobs with `javascript_tool`.
  - The figure shows both outlines, the L/R markers, the captions and the schematic note.
  - The legend has columns ID / Name / Entry / Target / Contacts and the key row.
  - Letters match the Planner legend, including when a grid electrode sits earlier in the order.
  - Export the Planner PNG again and confirm it is unchanged.
  - `npm run build` and `npm test` both pass.

- [ ] **Step 6: Commit.**
  `git add src/lib/export src/pages/Planner.tsx src/pages/AxialView.tsx && git commit -m "Export axial figure and contact legend as separate PNGs"`

---

### Task 5: Mirror support and README

**Files:**
- Modify: `src/store/useStore.ts` (`mirrorElectrode`, ~lines 702–787), `README.md`

**Interfaces:**
- Consumes: `mirrorAxial` from Task 2 and `AXIAL_VIEWS` from Task 1.

- [ ] **Step 1: Mirror the axial placement.** In `mirrorElectrode`, after `created` is assigned and while `historyBatch` is still set, add: if `source.axial` exists, call `get().updateElectrode(created.id, { axial: mirrorAxial(normalizeAxial(source.axial), AXIAL_VIEWS[source.axial.view]) })`. This keeps the mirror a single undo step. Grids never carry `axial` from this page, but the code may stay type-generic.

- [ ] **Step 2: Verify in the browser.** Place `LTMI` bottom-up with marks, then Mirror to R/L in the Planner. On the Axial view, `RTMI` sits on the opposite side of the midline with the same contacts and marks. One Ctrl+Z in the Planner removes `RTMI`.

- [ ] **Step 3: Update the README.**
  - Add an "Axial view" section under Basic use cases covering:
    - the purpose of the page;
    - the per-electrode view picker and its sides (bottom-up shows the patient's left on the viewer's right);
    - contacts at 3.5 mm from the tip;
    - click to cycle tissue, drag to move, the handle to rotate;
    - the schematic note;
    - Export PNG producing two files.
  - Add the two images to the Configuration files list.

- [ ] **Step 4: Final check.** Run `npm run build && npm test`; both pass. Run through Task 3's browser checks once more.

- [ ] **Step 5: Commit.**
  `git add src/store/useStore.ts README.md && git commit -m "Mirror axial placements and document the Axial view"`
