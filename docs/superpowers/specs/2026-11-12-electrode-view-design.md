# Electrode view (rework of the Axial view): design

Date: 2026-11-12 · Status: awaiting approval · Builds on
[2026-11-11-axial-contact-view-design.md](2026-11-11-axial-contact-view-design.md)

## Why

The Planner is the plan before surgery and **does not change**.

The Axial view page is for **after implantation**: it shows which contacts on each
electrode are actually usable, so a picture of it can go into the **clinical report** and
show what we are recording from. Three things get in the way today:

1. **Only two outlines, always both shown.** Some electrodes are much clearer from the
   side. A superior-frontal entry aimed at orbitofrontal cortex is best seen on a lateral
   or medial view, not from above or below. Empty outlines also end up in the picture.
2. **Fixed spacing looks wrong.** Contacts are drawn at 3.5 mm on an average-sized brain
   outline. In a real patient the R amygdala electrode may have contact 12 as the last one
   in brain, while on the picture contact 13 still sits inside the outline. The figure then
   contradicts the report.
3. **Report-unfriendly text and marking.** The figure carries "(from below)", "(from
   above)" and a "Schematic: …" note that the report doesn't need. Marking every outside
   contact by clicking is slow when the surgeon has already sent the numbers. There is
   also no way to mark a contact that was lost to noise during recording.

The surgeon's post-implant email looks like this (names are free text, not plan names):

```
Inferior temporal right - 6
R Amy - 12
R head Hip -14
R tail hip - 15
L Amy - 12
Left hip - 13
```

Each number is the **last contact inside the brain**: contacts 1–N are in brain, and
N+1 up to the contact count are outside.

## Goals

- **Six possible views.** Each electrode can go on one of: **bottom-up**, **top-down**,
  **left lateral**, **left medial**, **right lateral**, **right medial**, or **Off**.
- **Only views in use are shown.** A view with no electrode on it does not appear on the
  page and is not exported.
- **One picture per view**, with all electrodes on that view drawn together.
- **Each view exports as its own PNG.** The legend PNG is kept as a separate file (see
  Export).
- **Four contact states:**
  - grey matter: filled dark-grey dot (unchanged)
  - white matter: white dot with a dark outline (unchanged)
  - outside the brain: faded hollow dot with a small ✕ (unchanged)
  - **noisy / lost during recording (new)**: must be told apart from the other three on
    black-and-white print. Builder's call: a dot with a diagonal slash (⊘), so it isn't
    confused with the ✕ for outside.
- **"Last contact in brain" dropdown per electrode.** Below the contact count in the
  side list is a dropdown with values 1 to the contact count. Choosing N marks
  contacts N+1 to the end as **outside** automatically. Changing N updates them again.
  The user doesn't click outside contacts one by one.
- **Fit the drawing to the outline.** When "last contact in brain" is set below the
  contact count, that electrode's contact spacing is stretched or squeezed so that:
  - contact 1 stays at the tip (the target), and
  - the outline crossing falls **between** contact N (just inside) and contact N+1 (just
    outside).

  Contacts 1 to N+1 use the fitted spacing. Contacts beyond N+1 are all outside and
  continue at the **normal 3.5 mm scale**, so a long outside run doesn't push the drawing
  out and shrink the brain (user's choice).
- **Realistic, not just made to fit.** This is real patient data. Once the tip is on
  the rough target, the fitted spacing should be **very close to the true 3.5 mm scale**.
  The main thing that makes it differ is electrode tilt, and an electrode that is too
  tilted for a view belongs on another view. So the fit corrects small differences; it
  must not hide a bad view choice:
  - Each row shows how far that electrode's fitted spacing is from the true scale.
  - When it is off by more than a threshold (builder's call: about ±25%), the row shows a
    warning suggesting another view or checking the tip position. The electrode is still
    drawn.
- **Text on the figure.** Each exported view shows:
  - the outline,
  - **L/R markers**,
  - **electrode names** next to their shafts,
  - contact dots, plus contact numbers if the user turns them on (current behaviour:
    1 and last by default, "Show all contact numbers" toggle),
  - **a legend** for that view (see Export).

  **No view title, no "(from below)/(from above)" caption, and no schematic note.** The
  schematic note is also removed from the on-screen page.

## Non-goals

- Any change to the Planner.
- Reading or pasting the surgeon's email into the app. The user matches the surgeon's
  free-text names to plan electrodes and picks the number in the dropdown.
- Real 3D geometry or image registration. It stays a hand-placed schematic.
- Showing one electrode on more than one view.
- Shrinking or resizing the whole brain outline. Fitting is per electrode.
- Adding these views to PDF/PPTX export.

## Anti-goals (would be a failure even if it "works")

- A picture where a contact marked outside sits inside the outline, or a contact marked
  in brain sits outside it, once "last contact in brain" is set. That contradiction is
  what this rework is meant to fix.
- The number of dots differing from the contact count, or contact 1 not at the tip.
- An electrode drawn on the wrong side, or a view where a reader can't tell left from
  right.
- Noisy contacts that can't be told apart from the other states in black-and-white.
- Breaking existing plans: saved sessions and `.seegmap` files with bottom-up/top-down
  placements and grey/white/outside marks must open and look the same as before.
- Extra words on the exported pictures beyond L/R markers, electrode names, contact
  numbers and the legend.
- A fitted drawing that looks right but is far from the true scale without telling the
  user.

## Constraints

- Same stack and patterns as the current page: React + TS + Vite, Zustand store, Dexie
  autosave, SVG canvas, `html-to-image` capture, PNG with pHYs DPI, undo/redo.
- Fully client-side.
- The current page lives in [AxialView.tsx](../../../src/pages/AxialView.tsx),
  [AxialCanvas.tsx](../../../src/components/AxialCanvas.tsx),
  [AxialElectrodeList.tsx](../../../src/components/AxialElectrodeList.tsx),
  [axial.ts](../../../src/lib/axial.ts), [axialViews.ts](../../../src/lib/axialViews.ts),
  [axialStyle.ts](../../../src/lib/axialStyle.ts) and
  [axialLegend.ts](../../../src/lib/export/axialLegend.ts), with tests in
  [axial.test.ts](../../../src/lib/axial.test.ts) and
  [axialLegend.test.ts](../../../src/lib/export/axialLegend.test.ts).

## Decided (by the user)

- The Planner stays as it is.
- The page's purpose is post-implant: which contacts we are recording from.
- One view per picture, all its electrodes together; one PNG per view.
- The six views listed above; only views in use are shown.
- Four states: grey, white, outside, and **noisy**.
- A "last contact in brain" dropdown after the contact count, which auto-marks the
  remaining contacts as outside.
- The drawing should match the surgeon's numbers rather than a fixed average-brain scale.
- The exported picture keeps L/R markers, electrode names and **a legend**: no titles,
  no captions, no schematic note.
- **Medial views keep the Planner's arrangement**: anterior on the same side as the
  lateral view of that hemisphere, using the Planner's `leftMedial` / `rightMedial`
  panels as they are.
- **Outside contacts beyond N+1** are drawn at the normal 3.5 mm scale, not stretched.
- **Fitted spacing must stay close to the real scale**; a large difference means the
  electrode belongs on another view.

## Builder's calls (made in this document, open to change)

### Data model

- `Tissue` gains `"noisy"`.
- `AxialViewId` becomes
  `"inferior" | "superior" | "leftLateral" | "leftMedial" | "rightLateral" | "rightMedial"`.
  The existing ids keep their meaning, so old placements load unchanged.
- `AxialPlacement` gains an optional `lastInBrain?: number` (1..contacts). If it's absent,
  or equal to `contacts`, every contact is treated as in brain for fitting, and spacing
  is the current fixed 3.5 mm scale.
- **Outside is derived, not stored, when `lastInBrain` is set.** Contacts above N always
  read as `outside`. Contacts 1..N use their stored state, but a stored `outside` in that
  range reads as grey. Old plans without `lastInBrain` keep their stored marks exactly,
  including hand-clicked `outside`.
- The page keeps its route and nav tab. **Rename the tab "Electrode view"** to match its
  purpose (the user called it "more 'electrode' view"). The data field stays `axial` so
  saved plans don't need migrating.

### Clicking contacts

- In-brain contacts cycle **grey → white → noisy → grey**.
- When `lastInBrain` is set, clicking a contact above N does nothing, because the
  dropdown controls those. When it isn't set (old plans, or the user hasn't chosen),
  clicking cycles **grey → white → noisy → outside → grey**, so the page still works
  without the dropdown.

### Dropdown behaviour

- Default: unset, shown as "All" (every contact in brain).
- Lowering the contact count below `lastInBrain` clamps `lastInBrain` to the new count.
- Dropdown and count changes are single undo steps, like other edits.

### Fitting

- When `lastInBrain` = N < contacts: walk outward from the tip along the shaft direction
  in the view's outline image and find the first point where the shaft leaves the brain,
  i.e. the outermost outline line before white background. Set the electrode's spacing
  so that this point lies halfway between contact N and contact N+1:
  `spacing = distance(tip, crossing) / (N − 0.5)`.
- **What counts as brain.** Each view has a brain mask: everything not connected to the
  white background at the image border. Build it by flood-filling the background from the
  border; outline lines count as brain. White areas fully enclosed by outline count as
  brain, for example the brainstem cut-out in the bottom-up view or the area inside the
  corpus callosum curve in the medial views. Background gaps that open to the border do
  not, for example the notch under the frontal lobe in the lateral views or the
  interhemispheric gap from above.
- **Which crossing.** Use the **first exit**: march from the tip outward and stop at the
  first pixel outside the mask. A shaft that crosses a background gap and re-enters
  further out is an odd placement; the user can rotate it or use the handle below.
- Masks can be precomputed into small assets or computed when the image loads. That's
  the builder's choice.
- **"All" (no `lastInBrain`), or N = count.** Keep the fixed 3.5 mm spacing **unless**
  the last contact would land outside the mask. In that case shrink the spacing so the
  last contact sits just inside the outline (crossing at the last contact + half a
  spacing). That way an in-brain contact is never drawn outside the outline. Spacing is
  never stretched in this case.
- **Fallback and override.** If no crossing is found (the shaft points into the brain,
  or the tip was placed outside), keep the fixed 3.5 mm spacing and show a small warning
  on that electrode's row. **Build a drag handle for the crossing point from the start.**
  It appears on the selected electrode and overrides the detected crossing, which deals
  with odd outline shapes. Store it as an optional `edgeDist?: number` (distance from the
  tip, in the view's image pixels) on the placement, cleared by a "reset" action on the
  row. Dragging the tip or rotating the shaft keeps an
  overridden edge at the same distance from the tip.
- Fitting is recomputed live as the user drags the tip or rotates the shaft.

### Views and art

- **Bottom-up and top-down** keep their current images and configs.
- **Lateral and medial** are cropped from the Planner's newer template
  (`public/brain-template-v2.png`) using the quadrant bounding boxes in
  `public/brain-regions-v2.json` (`leftLateral`, `rightLateral`, `leftMedial`,
  `rightMedial`). Make them four static PNGs in `public/` (e.g. `view-left-lateral.png`),
  not crops at runtime. That keeps capture simple and lets better art drop in later.
- The template has **red guide lines baked into the image**. Remove them from the crops,
  either by repainting reddish pixels white or by cleaning the files by hand. The coloured
  insula/hippocampus/amygdala shading may stay.
- Each new view config needs: image, size, mm-per-pixel (about 170 mm front to back, as
  now), and which way is anterior. For lateral/medial views, "midline" mirroring doesn't
  apply (see Mirror).

### L/R markers

- **Bottom-up / top-down:** an L and an R on either side, as now. Seen from below, the
  patient's left is on the viewer's right.
- **Lateral / medial:** a single **L** or **R** in a corner, to say which hemisphere it is.
  The user asked for L/R markers and no titles, so this marker is what tells left lateral
  from right lateral. Whether lateral vs medial needs telling apart is left to the
  outline itself, which is easy to see.

### Default placement

- Choosing a view drops the electrode with a default tip and direction:
  - bottom-up/top-down: as now, in the electrode's hemisphere pointing laterally;
  - lateral/medial: tip near the centre of the outline, shaft pointing up and out
    (towards the top edge). The user drags it into place.
- The view picker offers all six. Builder's call: list the electrode's own hemisphere's
  lateral/medial first; still allow the other side.

### Mirror to R/L

- Bottom-up/top-down: as now, mirrored across the view's midline.
- Lateral/medial: move the placement to the **other hemisphere's** same view (left
  lateral ↔ right lateral), flipping x across the image (anterior swaps sides between the
  left and right images). `lastInBrain`, count and marks are carried over.

### Export

- **Export PNG** saves one PNG per view in use, plus the legend:
  - `<label>-<view>.png`, e.g. `patient-left-lateral.png`, `patient-bottom-up.png`;
  - `<label>-electrode-legend.png`.
- Each view PNG contains that view (the outline with its electrodes, L/R marker(s) and
  names) **plus its own legend**, beside or below the outline:
  - one row per electrode **on that view**: ID letter, name, entry → target, and contact
    ranges per state (format below);
  - the key of the four dot styles.

  Builder decides the layout, page size and DPI, keeping the current 300 dpi. Probably
  size it to the view plus legend rather than a whole A4 landscape page, since it goes
  into a report.
- The browser may ask once to allow several downloads. Keep the current alert telling the
  user what was saved, now listing all the files.
- **Combined legend PNG (builder's call: kept):** as now, one row per placed electrode
  across all views, with ID letter, name, entry, target,
  and contact ranges per state, now including `noisy`, e.g.
  `grey 1–3, 6 · white 4–5 · noisy 7 · outside 13–15`. The key shows all four dot styles.

### On-screen page

- Show only the views in use, laid out in a responsive grid in the fixed order: bottom-up,
  top-down, left lateral, left medial, right lateral, right medial.
- When nothing is placed yet, show a short empty-state hint in place of the figures.
- Remove the "(from below)" / "(from above)" captions and the schematic note. The
  instruction line in the toolbar is updated for the new click cycle and dropdown.

### README

- Update the "Mark contacts on the Axial view" section to match.

## Left to the builder

- How to detect the outline crossing, and its tolerances.
- Exact noisy-dot styling within the "distinct in black-and-white" rule.
- Component split, grid layout, and how each view is captured separately.
- Exact view PNG dimensions.
- Tests: extend `axial.test.ts` / `axialLegend.test.ts` for the new state, the dropdown
  rules, normalisation of new and old data, and the spacing formula. Verify the fitting
  visually in the browser preview on all six views.
