# Axial contact view: design

Date: 2026-11-11 · Status: awaiting approval

## Why

The Planner shows only side-on views (lateral and medial). A lateral–medial depth
electrode such as `LTMI` appears there as an entry dot and a target ✕, so you can't
see the shaft or its contacts. We implant Alcis electrodes with **3.5 mm**
centre-to-centre contact spacing. When an electrode is ordered with more contacts
than the trajectory needs (say 15), the outer contacts end up outside the brain.

The new page shows each electrode's full shaft, contact by contact, from below or
from above. It answers two questions for the team: which inner contacts are useful,
and which sit in white matter or outside the brain. It exports as its own PNG for
printing and sharing, with the legend as a separate image.

## Goals

- A new page, separate from the Planner, with its own route and nav tab. Working
  name: **"Axial view"**.
- Two brain outlines on the page, side by side:
  - **Bottom-up (inferior) view**: preferred for temporal and other low electrodes.
  - **Top-down (superior) view**: for frontal, parietal and higher electrodes.
- The user picks the view **per electrode**: inferior, superior, or not shown on
  this page.
- Electrodes come from the **existing plan**, with the same names, colours, entry and
  target labels and order. Nothing is entered twice.
- Each placed electrode is drawn as a straight shaft:
  - The user places the **tip**, which is contact 1 (the deepest), and sets the
    **direction** the electrode comes in from.
  - The user sets the **number of contacts** (e.g. 15).
  - Contacts are drawn from the tip outward at 3.5 mm spacing, converted to drawing
    distance by the view's scale (see Scale). Contacts past the brain outline are
    still drawn. That overhang is the point of the page.
- **Clicking a contact cycles its tissue state**: grey matter → white matter →
  outside the brain → grey matter. New contacts start as grey matter.
- Tissue states look distinct in print, including black-and-white print:
  - grey matter: filled dark-grey dot
  - white matter: white dot with a dark outline
  - outside the brain: faded hollow dot with a small ✕
  - The shaft line and name label use the electrode's own colour.
- **Export PNG** from this page produces **two PNG files**:
  1. the figure: both views, A4 landscape, 300 dpi, like the existing PNG export
     ([png.ts](../../../src/lib/export/png.ts));
  2. the legend: a separate image with one row per *placed* electrode, showing
     **ID letter, name, entry, target, and contact ranges per tissue state**, e.g.
     `1–4 grey · 5–9 white · 10–15 outside`, plus a key for the three dot styles.
- The axial placement, contact count and tissue marks **save with the plan**:
  IndexedDB autosave, `.seegmap` save/import, and undo/redo, like any other
  electrode edit.

## Non-goals

- Subdural grids and strips (`type: "grid"`). They aren't depth electrodes and are not
  listed on this page.
- Real 3D or image-registered geometry. This is a schematic on line-art outlines;
  positions are hand-placed like the rest of the app.
- Automatically deciding grey/white/outside from the outline. The user marks every
  contact by hand.
- Adding the axial view to PDF or PPTX exports (possible later).
- Syncing between views: moving an electrode in the Planner does not move it here,
  and the reverse.
- Per-electrode spacing other than 3.5 mm. One spacing for the whole page, set in
  code as a constant.

## Anti-goals (would be a failure even if it "works")

- A contact count or spacing that silently differs from what the user set. The
  number of dots must equal the number of contacts, and contact 1 must be at the tip.
- Showing an electrode on the wrong side. Each view must be labelled clearly for side
  (see Orientation below).
- Tissue colours that can't be told apart on a black-and-white printout.
- Breaking existing plans: old `.seegmap` files and saved sessions must open
  unchanged, with no axial placement.

## Constraints

- Stack as already used: React + TypeScript + Vite, Zustand store
  ([useStore.ts](../../../src/store/useStore.ts)), Dexie autosave, SVG canvas,
  `html-to-image` capture, canvas-composited PNG with pHYs DPI.
- Fully client-side; no backend.
- Outline images: the two line drawings supplied by the user; see Assets.

## Decided

- Both views on one page; view chosen per electrode.
- Tip = contact 1 = deepest; contacts run outward from the tip.
- 3.5 mm spacing.
- Click to cycle grey → white → outside.
- Separate legend image with name, entry, target and contact ranges per tissue state.
- Lives on its own page and exports its own PNG.

## Builder's calls (made in this document, open to change)

- **Data model.** Add an optional field to `BaseElectrode`, so it applies to
  lateral–medial and superior–inferior electrodes:

  ```ts
  type Tissue = "grey" | "white" | "outside";
  interface AxialPlacement {
    view: "inferior" | "superior";
    tip: Point;        // normalised 0..1 on that view's image
    toward: Point;     // a point along the shaft, outward from the tip; only its direction matters
    contacts: number;  // 1..24
    tissue: Tissue[];  // length === contacts; index 0 = contact 1
  }
  axial?: AxialPlacement;
  ```

  Missing = not shown on this page. Changing `contacts` keeps existing marks for
  contacts that remain, and adds new outer contacts as `"grey"`.
- **Default contact count** when an electrode is first placed: 10. The user changes it
  in the side panel.
- **Placing.** In the page's electrode list, each row has a view picker (Off / Bottom-up /
  Top-down) and a contact-count field. Choosing a view drops the electrode on that view
  with a default tip near the centre of the correct hemisphere and a direction pointing
  laterally. The user then drags the tip and a small direction handle at the outer end.
  Clicking a contact cycles its tissue state; dragging moves the shaft. Contact clicks
  and handle drags must not conflict, for example with a short drag threshold.
- **Scale.** Each view image gets one constant, mm per image pixel, from typical adult
  brain size: about 170 mm front to back for the outline's longest axis. It lives with
  the view config and is not shown in the UI.
- **Mirror to R/L.** When the source has an axial placement, mirror it horizontally on
  the same view, keeping contacts and tissue marks.
- **Labels.** Electrode name next to the outermost contact; contact numbers optional
  through a "Show contact numbers" toggle, default on for 1 and the last contact only.
- **Legend ranges.** Consecutive contacts with the same state collapse into a range
  (`1–4`); a state with no contacts is omitted; non-contiguous runs are listed
  separately (`grey 1–3, 6`).
- **Legend lettering.** Uses the same A, B, C… letters as the Planner legend
  (`electrodeLetter` over the plan order), so a letter means the same electrode on
  both printouts.
- **File names.** `<patient>-axial.png` and `<patient>-axial-legend.png`.

## Left to the builder

- Component structure, whether to reuse `BrainCanvas` pieces or write a smaller SVG
  canvas for this page.
- Exact dot sizes, label offsets and handle styling.
- Exact legend layout, reusing `LegendTable` where it fits.
- Tests. The project has no test runner today; at minimum, verify in the browser
  preview.

## Orientation (decided)

- Each view shows **true anatomical sides**, with a clear **L** and **R** marker on
  each outline, plus a small "from below" or "from above" caption.
- Both outlines have **anterior at the top**.
  - **Top-down (superior) view**: patient's left is on the viewer's **left**.
  - **Bottom-up (inferior) view**: patient's left is on the viewer's **right**, as on
    an axial MRI slice.
- An electrode's hemisphere comes from its leading `L`/`R`. When it is first placed,
  the default tip goes in that hemisphere *for that view*, with the shaft pointing
  laterally, out of the brain on that side. Names with no `L`/`R` default to the
  viewer's left half (builder's call).
- **Mirror to R/L** reflects the tip and direction across the view's own midline. Each
  view config stores its midline x, measured from the image, not assumed to be 0.5.

## Schematic, not to true projection (decided)

Every shaft is drawn at full length with 3.5 mm spacing, as if it ran level in the
axial plane. That's right for temporal and most lateral–medial electrodes; a steep
superior–inferior electrode would really look shorter from above or below. The page
shows a short note to that effect, and the note also appears in small print on the
exported figure. No angle field.

## Assets (decided)

- The user supplied the two outline images in this session: a top-down (superior)
  view of about 452 × 603 px and a bottom-up (inferior) view of about 429 × 529 px.
  They'll be copied into `public/` as `axial-superior.png` and `axial-inferior.png`.
  The superior image has a stray dark bar along its bottom edge; crop it off.
- Softness when printed at A4/300 dpi is **accepted** for now. Better art can replace
  the files later; the per-view config (size, scale, midline) is the only thing
  that would need updating.
- Each view config holds: image file, native width/height, midline x, and mm per
  image pixel (from about 170 mm front to back over the outline's height).
