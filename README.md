# sEEGmap

Interactive 2D stereoelectroencephalography (sEEG) planning tool for epilepsy surgery
planning. Entirely browser-based: no backend, no authentication, no cloud dependency.

https://seegmap.github.io/

**For sEEG planning only. Not intended to replace physician assessment or approved for clinical use.**

Created by [Serdar Akkol, MD PhD](https://sakkol.github.io) at Comprehensive Epilepsy Center of Duke University.

Please contact for any questions or feedback!

Build using Anthropic Claude Sonnet 5 and ChatGPT - beware of errors.

## Stack

React + TypeScript + Vite · Zustand · Dexie (IndexedDB) · dnd-kit · PptxGenJS · jsPDF ·
html-to-image · PapaParse

## Data & privacy

All plan data (electrodes, notes, ordering) autosaves to **IndexedDB in the current
browser only**. Nothing is uploaded anywhere. Clearing browser storage / using a
different browser or device means the saved session won't be there — use **Export →
Save .seegmap** regularly and/or **Export PDF/PNG/PPTX** for anything you need to keep.

## Basic use cases

### Start a plan

- **New Plan** (Home) starts an empty plan and takes you to the Planner. If a session is
  already saved in this browser, you'll be asked to confirm before it's discarded.
- **Restore Last Session** reloads the plan autosaved to this browser's IndexedDB.
- **Import .seegmap** loads a previously exported `.seegmap` file (see Export below) —
  useful for moving a plan between browsers/devices or reopening an archived case.

### Add an electrode

In the Planner, **+ Add Electrode** (top of the right-hand panel) opens a dialog with four
tabs:

1. **Library** — browse the full anatomical library (see Nomenclature below), filter by
   target/entry/code, and check off one or more entries to place at once. Rows already in
   your plan are marked "Added".
2. **By Name** — type a name (e.g. `LTAI`, `LTMI`, `LAI`) and the app places it
   automatically: an exact match in the anatomical library places precisely with the
   correct entry/target labels; otherwise the app falls back to parsing the name as a
   standard lateral‑medial or superior‑inferior code and places an approximate position
   from the region grid for you to verify.
3. **Manual** — build a name from dropdowns (side / lobe / A‑M‑P / S‑M‑I, or side / A‑P /
   structure code) without needing to know the code by heart, and place it at a default
   position you then drag into place.
4. **By Target** — search anatomical targets by name (e.g. "Amygdala") and place both
   target and entry from the library match.

### Work the canvas

- **Drag** any entry or target marker to reposition it; drag the connecting line's
  midpoint to bow a trajectory.
- **Click** an electrode (on the canvas or in the side list) to select it — arrow keys
  nudge the selection by 1 px (hold Shift for 10 px), `Delete`/`Backspace` removes it,
  `Esc` deselects.
- **Mirror to R/L** duplicates the selected electrode to the opposite hemisphere with the
  side flipped in its name.
- **Show Names** toggles marker labels on the canvas.
- **Draw Area** lets you trace a freehand sketch (e.g. to mark a resection or lesion
  outline) in a color/opacity you choose; sketches are listed and manageable below the
  electrode table.
- **Undo / Redo** (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`) covers electrode and sketch edits.
- In the side panel, rename an electrode or edit its entry/target labels inline; use the
  **⋮** menu on a row for notes, marker color, and delete.
- Drag rows by their grip handle to reorder the electrode list (order carries into
  exports).

### Export / save

- **Save .seegmap** downloads the full plan (electrodes, sketches, notes, patient label)
  as a `.seegmap` JSON file — re-import it later via **Import .seegmap** on Home.
- **Export PNG / PDF / PPTX** render the current canvas (plus, for PDF/PPTX, an
  electrode table and notes page/slide) for sharing or printing. None of these are
  saved anywhere automatically — download what you need to keep.

### Maintain the anatomical library

Settings → Anatomical Library lets you browse, search, add, edit, delete, and
import/export (CSV or JSON) the target/entry records used by the **Library** and **By
Target** tabs. Two click-to-build tools are also available as tabs on that page:

- **Click-to-build** — look up or start a lateral‑medial library record, click directly
  on the brain template to set its target and entry points, then export queued changes
  as CSV.
- **Click-to-build (S–I)** — the equivalent tool for superior‑to‑inferior trajectory
  electrodes (see Nomenclature below): click through the four points of a trajectory
  (lateral start/end, medial start/end), queue as many electrodes as you like, and
  export the queue as JSON to merge by hand into `public/superior-inferior-regions.json`.

## Electrode nomenclature

sEEGmap electrodes fall into two placement styles, distinguished by name.

### Lateral–medial (4-letter code)

Format: `[Side][Lobe][A/M/P][S/M/I]`, e.g. `LTMI` = Left Temporal Middle Inferior.

| Position | Codes |
| --- | --- |
| Side | `L` Left · `R` Right |
| Lobe | `F` Frontal · `T` Temporal · `P` Parietal · `O` Occipital · `I` Insular · `C` Cingulate |
| Anterior/Middle/Posterior | `A` · `M` · `P` |
| Superior/Middle/Inferior | `S` · `M` · `I` |

A lateral‑medial electrode has one **entry** point and one **target** point, connected by
a straight trajectory line. If the exact name matches an entry in the anatomical library
(e.g. `LTAI`), it's placed at that library's curated coordinates with real target/entry
labels. Otherwise, a valid 4-letter code is placed approximately from
`brain-regions.json`'s Anterior/Middle/Posterior × Superior/Middle/Inferior grid for that
side/lobe quadrant — always verify and drag into the correct position before use. Names
that don't parse as a 4-letter code (e.g. a name describing a lesion) are still accepted
and placed manually at a default position.

### Superior–inferior (trajectory code)

Format: `[Side][A/P][Structure code]`, e.g. `LAI`, `RPF`. Unlike the lateral‑medial code,
the structure code (the last 1–2 characters) is free text you define — the Manual tab
caps it at 2 characters, but it isn't a fixed lookup table like `LOBE_CODES` above. Pick a
convention that fits your unit (e.g. `I` for Insula, `F` for Frontal) and keep it
consistent with the names you use in `superior-inferior-regions.json`.

A superior‑inferior electrode is drawn as a line on the **Lateral** view: an entry dot
(●) joined to an end marker (✕). Use it for any trajectory whose length runs mostly
front–back or up–down, which a side-on view shows well, such as an insular electrode
entering from above or a temporal-pole electrode running along the pole. If the exact
name matches a key in `superior-inferior-regions.json`, both points are placed from that
config; otherwise it's added manually via the Manual tab and positioned by dragging, or
built with the Anatomical Library's S–I click-to-build tool.

When the tip ends in mesial structures, open the row's **⋮** menu and choose **Add
medial ✕**. This adds a third marker on the same hemisphere's **Medial** view, placed at
the matching position, for you to drag to where the tip ends. **Remove medial ✕** takes
it off. The medial marker moves with arrow-key nudges, mirrors with **Mirror to R/L**,
follows the row's ✕ visibility toggle, and appears in the PPTX export. It is not yet
read from `superior-inferior-regions.json` or set by the click-to-build tool.

### Mirroring and lesion names

**Mirror to R/L** requires the electrode's name to start with `L` or `R`; it flips that
leading letter and mirrors coordinates horizontally (using the matching library entry for
the new name when one exists) to produce the equivalent electrode on the opposite
hemisphere. It refuses if the mirrored name is already in your plan. Free-form lesion
markers named e.g. `LLESA`, `LLESB`, … auto-increment the trailing letter per side so you
don't have to track which suffixes are already in use.

## Brain figures (legacy and new)

sEEGmap ships two brain figures, selectable per plan:

- **Legacy** — `brain-template.png` (1770 × 1281 px)
- **New** — `brain-template-v2.png` (3147 × 1903 px)

Pick the figure for a new plan on Home; switch any time from the **Figure** toggle in the
planner. Electrode positions are stored as fractions of the image, so they keep their relative
position when you switch (the figures are not anatomically aligned, so re-check placement).
The figure is saved with the plan (`figure` in `.seegmap`); files without it open as legacy.

Each figure has its own files in `public/`, with coordinates in that figure's native pixels:

| | Legacy | New |
| --- | --- | --- |
| Image | `brain-template.png` | `brain-template-v2.png` |
| Quadrants | `brain-regions.json` | `brain-regions-v2.json` |
| Anatomical library | `anatomy-library.csv` | `anatomy-library-v2.csv` |
| Superior–inferior | `superior-inferior-regions.json` | `superior-inferior-regions-v2.json` |

The v2 data files were produced by scaling the legacy coordinates (x × 3147/1770, y × 1903/1281)
and need hand-tuning. Settings → Anatomical Library has a "Library for" picker that switches the
list, import/export and both click-to-build tools between the two libraries. A library edited in
the browser is kept in IndexedDB and wins over the shipped CSV; use **Reset to shipped** to reload
the CSV after you change it.

## Configuration files (`public/`)

These drive the app without needing a rebuild for content changes (only a redeploy):

- `app-config.json` — Home screen contact/institution block.
- `brain-regions.json` — quadrant bounding boxes (measured from the shipped
  `brain-template.png`) used to auto-place lateral-medial electrodes from a parsed
  4-letter code (e.g. `LTMI`).
- `superior-inferior-regions.json` — named anchor coordinates (e.g. `LAI`, `RPF`) used
  to auto-place superior-inferior electrodes from an exact name match.
- `anatomy-library.csv` — the seed anatomical target/entry library used by the "By
  Target" add workflow and the Settings → Anatomical Library page. Fully editable
  in-app (Import/Export CSV or JSON), or edit this file directly before deploying to
  change the shipped default for all users.

## Important limitation — please read

`brain-regions.json`'s auto-placement grid and every coordinate in the seeded
`anatomy-library.csv` are **first-pass approximations**, generated from the general
shape of the supplied line-art template rather than from verified individual
neuroanatomy. They exist to save clicks, not to encode clinical ground truth. The app
deliberately makes every marker draggable and every name/note field editable so a
clinician can correct placement before it's used for anything. Please review and adjust
region/library coordinates for your own template and workflow, and always visually
verify final electrode placement against real imaging — this tool does not import,
register, or reason about MRI/CT data.

## Architecture notes for future extension

The data model (`src/types.ts`) stores every point as `{x, y}` normalized 0–1 against
the full template image — the "master coordinate system" called for in the spec. That
makes it straightforward to later add MRI/CT overlays, alternate templates, trajectory
analysis, or collaborative/cloud sync as additional layers without changing how
electrodes are stored.
