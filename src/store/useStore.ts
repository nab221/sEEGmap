import { create } from "zustand";
import { v4 as uuid } from "uuid";
import Papa from "papaparse";
import { db } from "../db/db";
import type {
  AnatomyRecord,
  BrainRegionsConfig,
  Electrode,
  FigureId,
  FreehandSketch,
  GridElectrode,
  LateralMedialElectrode,
  Point,
  SIRegionsConfig,
  SeegPlanFile,
  SuperiorInferiorElectrode,
  TextAnnotation,
} from "../types";
import { CURRENT_FORMAT_VERSION } from "../types";
import {
  buildLateralMedialName,
  isNameTaken,
  parseLateralMedialName,
} from "../lib/nomenclature";
import { gridPositionInQuadrant, pixelToNormalized } from "../lib/coords";
import { clampTranslation } from "../lib/geometry";
import { defaultGridSize } from "../lib/grid";
import { mirrorAxial, normalizeAxial } from "../lib/axial";
import { AXIAL_VIEWS } from "../lib/axialViews";
import { FIGURES, FIGURE_ORDER, isFigureId, loadFigurePref, saveFigurePref } from "../lib/figures";

const PALETTE = [
  "#2F6F6B", "#C0392B", "#8E5AC8", "#D68910", "#2E6DA4",
  "#16A085", "#A93472", "#5D6D7E", "#B7950B", "#1F618D",
];

function nextColor(existing: Electrode[]): string {
  return PALETTE[existing.length % PALETTE.length];
}

function nowISO() {
  return new Date().toISOString();
}

/** Everything that is specific to one brain figure: its quadrant config, S-I config and library. */
interface FigureLibrary {
  regions: BrainRegionsConfig | null;
  siRegions: SIRegionsConfig | null;
  anatomy: AnatomyRecord[];
}

function emptyLibraries(): Record<FigureId, FigureLibrary> {
  return {
    legacy: { regions: null, siRegions: null, anatomy: [] },
    v2: { regions: null, siRegions: null, anatomy: [] },
  };
}

/**
 * `regions`, `siRegions` and `anatomy` on the store always mirror the *active* figure's
 * library, so placement code and the Add Electrode dialog never need to know about figures.
 * Whenever `libraries` or `figure` changes, spread this into `set()` to keep them in sync.
 */
function withActive(libraries: Record<FigureId, FigureLibrary>, figure: FigureId) {
  const lib = libraries[figure];
  return { libraries, regions: lib.regions, siRegions: lib.siRegions, anatomy: lib.anatomy };
}

function patchLibrary(
  set: (partial: Partial<StoreState>) => void,
  get: () => StoreState,
  figure: FigureId,
  patch: Partial<FigureLibrary>
) {
  const s = get();
  const libraries = { ...s.libraries, [figure]: { ...s.libraries[figure], ...patch } };
  set(withActive(libraries, s.figure));
}

type AnatomyDraft = Omit<AnatomyRecord, "id" | "fileOrder" | "figure">;

function parseAnatomyCsv(text: string): { records: AnatomyDraft[]; fileOrderByName: Map<string, number> } {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  // Row position in the shipped CSV, keyed by electrode code -- used both to seed
  // fileOrder on first run and to backfill it for records already in IndexedDB.
  const fileOrderByName = new Map<string, number>();
  parsed.data.forEach((row, idx) => {
    const code = (row.ElectrodeName ?? "").trim().toUpperCase();
    if (code && !fileOrderByName.has(code)) fileOrderByName.set(code, idx);
  });
  const records = parsed.data.map((row) => ({
    targetName: row.TargetName ?? "",
    preferredEntry: row.PreferredEntry ?? "",
    targetX: Number(row.TargetX) || 0,
    targetY: Number(row.TargetY) || 0,
    entryX: Number(row.EntryX) || 0,
    entryY: Number(row.EntryY) || 0,
    category: row.Category ?? "",
    comments: row.Comments ?? "",
    electrodeName: row.ElectrodeName ?? "",
  }));
  return { records, fileOrderByName };
}

async function fetchShipped(file: string): Promise<Response> {
  const res = await fetch(`${import.meta.env.BASE_URL}${file}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${file} (HTTP ${res.status})`);
  return res;
}

/**
 * Load one figure's config files and its library. A library already saved in IndexedDB wins
 * over the shipped CSV (so in-app edits persist); otherwise the CSV seeds it on first run.
 * A figure whose files can't be loaded degrades to an empty library instead of breaking the app.
 */
async function loadFigureLibrary(figure: FigureId, stored: AnatomyRecord[]): Promise<FigureLibrary> {
  const cfg = FIGURES[figure];
  let regions: BrainRegionsConfig;
  let siRegions: SIRegionsConfig;
  let csvText: string;
  try {
    [regions, siRegions, csvText] = await Promise.all([
      fetchShipped(cfg.regionsFile).then((r) => r.json() as Promise<BrainRegionsConfig>),
      fetchShipped(cfg.siRegionsFile).then((r) => r.json() as Promise<SIRegionsConfig>),
      fetchShipped(cfg.libraryFile).then((r) => r.text()),
    ]);
  } catch (err) {
    console.warn(`Could not load the ${cfg.label} configuration files.`, err);
    return { regions: null, siRegions: null, anatomy: stored };
  }

  const { records: seed, fileOrderByName } = parseAnatomyCsv(csvText);

  if (stored.length > 0) {
    // Backfill electrodeName for records saved before that field existed, so lookups
    // never crash on `undefined.trim()`. Also backfill fileOrder for records saved before
    // it existed (or unmatched against the current CSV) using their existing array
    // position, so the Library list has a stable order either way.
    const needsBackfill = stored.some(
      (a) => a.electrodeName === undefined || a.electrodeName === null || a.fileOrder === undefined
    );
    const normalized = stored.map((a, idx) => {
      const electrodeName = a.electrodeName ?? "";
      const fileOrder = a.fileOrder ?? fileOrderByName.get(electrodeName.trim().toUpperCase()) ?? idx;
      return { ...a, electrodeName, fileOrder };
    });
    if (needsBackfill) await db.anatomy.bulkPut(normalized);
    return { regions, siRegions, anatomy: normalized };
  }

  // Seed from the shipped CSV on first run and persist into IndexedDB.
  const anatomy: AnatomyRecord[] = seed.map((row, idx) => ({ ...row, id: uuid(), fileOrder: idx, figure }));
  await db.anatomy.bulkAdd(anatomy);
  return { regions, siRegions, anatomy };
}

// loadConfigs() can be called twice at startup (React StrictMode re-runs effects in dev).
// Sharing one in-flight promise stops two callers from both seeding an empty library.
let configsPromise: Promise<void> | null = null;

interface PlanSnapshot {
  electrodes: Electrode[];
  sketches: FreehandSketch[];
  texts: TextAnnotation[];
}

function cloneSnapshot(s: Pick<StoreState, "electrodes" | "sketches" | "texts">): PlanSnapshot {
  return {
    electrodes: JSON.parse(JSON.stringify(s.electrodes)) as Electrode[],
    sketches: JSON.parse(JSON.stringify(s.sketches)) as FreehandSketch[],
    texts: JSON.parse(JSON.stringify(s.texts)) as TextAnnotation[],
  };
}

function snapshotsEqual(a: PlanSnapshot, b: PlanSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface HistoryBatch {
  before: PlanSnapshot;
}

interface StoreState {
  // figure
  /** Which brain figure the plan is drawn on. Saved with the plan. */
  figure: FigureId;
  /** Switch the figure. Positions are kept as-is (they're normalized 0..1 on the image). */
  setFigure: (id: FigureId) => void;
  /** Config + library for every figure. */
  libraries: Record<FigureId, FigureLibrary>;

  // config -- these three always mirror the ACTIVE figure's entry in `libraries`
  regions: BrainRegionsConfig | null;
  siRegions: SIRegionsConfig | null;
  anatomy: AnatomyRecord[];

  // plan
  electrodes: Electrode[];
  sketches: FreehandSketch[];
  texts: TextAnnotation[];
  patientLabel: string;
  planNotes: string;
  selectedId: string | null;
  hoveredId: string | null;
  searchQuery: string;
  hydrated: boolean;

  // undo / redo
  undoStack: PlanSnapshot[];
  redoStack: PlanSnapshot[];
  beginHistoryBatch: () => void;
  endHistoryBatch: () => void;
  undo: () => void;
  redo: () => void;
  nudgeSelection: (dx: number, dy: number) => void;

  // canvas ui state
  showNames: boolean;
  toggleShowNames: () => void;
  drawMode: boolean;
  setDrawMode: (v: boolean) => void;
  sketchDraftColor: string;
  sketchDraftOpacity: number;
  setSketchDraft: (patch: { color?: string; opacity?: number }) => void;
  selectedSketchId: string | null;
  setSelectedSketchId: (id: string | null) => void;
  /** "Add Text" placement mode: the next canvas click drops a label. */
  textMode: boolean;
  setTextMode: (v: boolean) => void;
  textDraft: { content: string; color: string; fontSize: number; bold: boolean };
  setTextDraft: (patch: Partial<StoreState["textDraft"]>) => void;
  selectedTextId: string | null;
  setSelectedTextId: (id: string | null) => void;

  // actions: bootstrap
  loadConfigs: () => Promise<void>;
  hydrateFromDB: () => Promise<void>;

  // actions: electrodes
  addLateralMedial: (partial?: Partial<LateralMedialElectrode>) => LateralMedialElectrode;
  addSuperiorInferior: (partial?: Partial<SuperiorInferiorElectrode>) => SuperiorInferiorElectrode;
  addGrid: (partial?: Partial<GridElectrode>) => GridElectrode;
  addByName: (name: string, mode?: Electrode["type"]) => { ok: boolean; message: string };
  mirrorElectrode: (id: string) => { ok: boolean; message: string };
  addByAnatomy: (record: AnatomyRecord) => void;
  updateElectrode: (id: string, patch: Partial<Electrode>) => void;
  renameElectrode: (id: string, name: string) => { ok: boolean; message: string };
  removeElectrode: (id: string) => void;
  reorderElectrodes: (orderedIds: string[]) => void;
  setSelected: (id: string | null) => void;
  setHovered: (id: string | null) => void;
  setSearchQuery: (q: string) => void;

  // actions: sketches
  addSketch: (points: Point[]) => void;
  duplicateSketch: (id: string) => void;
  updateSketch: (id: string, patch: Partial<FreehandSketch>) => void;
  removeSketch: (id: string) => void;

  // actions: text annotations
  addText: (position: Point, content?: string) => TextAnnotation;
  updateText: (id: string, patch: Partial<TextAnnotation>) => void;
  duplicateText: (id: string) => void;
  removeText: (id: string) => void;

  // actions: anatomy library. `figure` picks which figure's library to change; it defaults
  // to the active figure.
  addAnatomyRecord: (rec: Omit<AnatomyRecord, "id" | "fileOrder">, figure?: FigureId) => void;
  updateAnatomyRecord: (id: string, patch: Partial<AnatomyRecord>, figure?: FigureId) => void;
  removeAnatomyRecord: (id: string, figure?: FigureId) => void;
  replaceAnatomyLibrary: (records: Omit<AnatomyRecord, "id" | "fileOrder">[], figure?: FigureId) => void;
  /** Re-read the shipped CSV for a figure and replace that figure's saved library with it. */
  restoreShippedAnatomy: (figure?: FigureId) => Promise<number>;

  // actions: session / files
  newPlan: (figure?: FigureId) => Promise<void>;
  loadPlanFile: (file: SeegPlanFile) => void;
  exportPlanFile: () => SeegPlanFile;
  setPatientLabel: (v: string) => void;
  setPlanNotes: (v: string) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let historyBatch: HistoryBatch | null = null;

function pushHistory(set: any, get: () => StoreState, before: PlanSnapshot) {
  const current = cloneSnapshot(get());
  if (snapshotsEqual(before, current)) return;
  set((s: StoreState) => ({ undoStack: [...s.undoStack, before].slice(-100), redoStack: [] }));
}

function scheduleAutosave(get: () => StoreState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const s = get();
    await db.transaction("rw", db.electrodes, db.session, db.sketches, db.texts, async () => {
      await db.electrodes.clear();
      await db.electrodes.bulkAdd(s.electrodes);
      await db.sketches.clear();
      await db.sketches.bulkAdd(s.sketches);
      await db.texts.clear();
      await db.texts.bulkAdd(s.texts);
      await db.session.put({
        key: "current",
        patientLabel: s.patientLabel,
        planNotes: s.planNotes,
        figure: s.figure,
        updatedAt: nowISO(),
      });
    });
  }, 350);
}

export const useStore = create<StoreState>((set, get) => ({
  figure: loadFigurePref(),
  libraries: emptyLibraries(),
  regions: null,
  siRegions: null,
  anatomy: [],
  electrodes: [],
  sketches: [],
  texts: [],
  patientLabel: "",
  planNotes: "",
  selectedId: null,
  hoveredId: null,
  searchQuery: "",
  hydrated: false,

  undoStack: [],
  redoStack: [],

  showNames: true,
  toggleShowNames: () => set((s) => ({ showNames: !s.showNames })),
  drawMode: false,
  setDrawMode: (v) =>
    set({
      drawMode: v,
      // Only one placement mode can be armed at a time.
      textMode: v ? false : get().textMode,
      selectedId: v ? null : get().selectedId,
      selectedSketchId: v ? null : get().selectedSketchId,
      selectedTextId: v ? null : get().selectedTextId,
    }),
  sketchDraftColor: "#D68910",
  sketchDraftOpacity: 0.35,
  setSketchDraft: (patch) =>
    set((s) => ({
      sketchDraftColor: patch.color ?? s.sketchDraftColor,
      sketchDraftOpacity: patch.opacity ?? s.sketchDraftOpacity,
    })),
  selectedSketchId: null,
  setSelectedSketchId: (id) =>
    set({
      selectedSketchId: id,
      selectedId: id ? null : get().selectedId,
      selectedTextId: id ? null : get().selectedTextId,
    }),

  textMode: false,
  setTextMode: (v) =>
    set({
      textMode: v,
      drawMode: v ? false : get().drawMode,
      selectedId: v ? null : get().selectedId,
      selectedSketchId: v ? null : get().selectedSketchId,
    }),
  textDraft: { content: "", color: "#182430", fontSize: 26, bold: true },
  setTextDraft: (patch) => set((s) => ({ textDraft: { ...s.textDraft, ...patch } })),
  selectedTextId: null,
  setSelectedTextId: (id) =>
    set({
      selectedTextId: id,
      selectedId: id ? null : get().selectedId,
      selectedSketchId: id ? null : get().selectedSketchId,
    }),

  beginHistoryBatch: () => {
    if (!historyBatch) historyBatch = { before: cloneSnapshot(get()) };
  },

  endHistoryBatch: () => {
    if (!historyBatch) return;
    const before = historyBatch.before;
    historyBatch = null;
    pushHistory(set, get, before);
  },

  nudgeSelection: (dx, dy) => {
    const s = get();
    if (s.selectedId) {
      const electrode = s.electrodes.find((e) => e.id === s.selectedId);
      if (!electrode) return;
      if (electrode.type === "lateral-medial") {
        s.updateElectrode(electrode.id, {
          entry: { x: Math.min(1, Math.max(0, electrode.entry.x + dx)), y: Math.min(1, Math.max(0, electrode.entry.y + dy)) },
          target: { x: Math.min(1, Math.max(0, electrode.target.x + dx)), y: Math.min(1, Math.max(0, electrode.target.y + dy)) },
        });
      } else if (electrode.type === "grid") {
        s.updateElectrode(electrode.id, {
          center: {
            x: Math.min(1, Math.max(0, electrode.center.x + dx)),
            y: Math.min(1, Math.max(0, electrode.center.y + dy)),
          },
        } as Partial<Electrode>);
      } else {
        const move = (p: Point): Point => ({
          x: Math.min(1, Math.max(0, p.x + dx)),
          y: Math.min(1, Math.max(0, p.y + dy)),
        });
        s.updateElectrode(electrode.id, {
          lateralStart: move(electrode.lateralStart),
          lateralEnd: move(electrode.lateralEnd),
          ...(electrode.medialTarget ? { medialTarget: move(electrode.medialTarget) } : {}),
        });
      }
      return;
    }
    if (s.selectedSketchId) {
      const sketch = s.sketches.find((sk) => sk.id === s.selectedSketchId);
      if (!sketch) return;
      s.updateSketch(sketch.id, {
        points: sketch.points.map((p) => ({
          x: Math.min(1, Math.max(0, p.x + dx)),
          y: Math.min(1, Math.max(0, p.y + dy)),
        })),
      });
      return;
    }
    if (s.selectedTextId) {
      const text = s.texts.find((t) => t.id === s.selectedTextId);
      if (!text) return;
      s.updateText(text.id, {
        position: {
          x: Math.min(1, Math.max(0, text.position.x + dx)),
          y: Math.min(1, Math.max(0, text.position.y + dy)),
        },
      });
    }
  },

  undo: () => {
    const s = get();
    const before = s.undoStack[s.undoStack.length - 1];
    if (!before) return;
    const current = cloneSnapshot(s);
    set({
      electrodes: JSON.parse(JSON.stringify(before.electrodes)) as Electrode[],
      sketches: JSON.parse(JSON.stringify(before.sketches)) as FreehandSketch[],
      texts: JSON.parse(JSON.stringify(before.texts ?? [])) as TextAnnotation[],
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, current].slice(-100),
      selectedId: s.selectedId && before.electrodes.some((e) => e.id === s.selectedId) ? s.selectedId : null,
      selectedSketchId: s.selectedSketchId && before.sketches.some((sk) => sk.id === s.selectedSketchId) ? s.selectedSketchId : null,
      selectedTextId: s.selectedTextId && (before.texts ?? []).some((t) => t.id === s.selectedTextId) ? s.selectedTextId : null,
    });
    scheduleAutosave(get);
  },

  redo: () => {
    const s = get();
    const next = s.redoStack[s.redoStack.length - 1];
    if (!next) return;
    const current = cloneSnapshot(s);
    set({
      electrodes: JSON.parse(JSON.stringify(next.electrodes)) as Electrode[],
      sketches: JSON.parse(JSON.stringify(next.sketches)) as FreehandSketch[],
      texts: JSON.parse(JSON.stringify(next.texts ?? [])) as TextAnnotation[],
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, current].slice(-100),
      selectedId: s.selectedId && next.electrodes.some((e) => e.id === s.selectedId) ? s.selectedId : null,
      selectedSketchId: s.selectedSketchId && next.sketches.some((sk) => sk.id === s.selectedSketchId) ? s.selectedSketchId : null,
      selectedTextId: s.selectedTextId && (next.texts ?? []).some((t) => t.id === s.selectedTextId) ? s.selectedTextId : null,
    });
    scheduleAutosave(get);
  },

  setFigure: (id) => {
    const s = get();
    if (id === s.figure || !isFigureId(id)) return;
    saveFigurePref(id);
    set({ figure: id, ...withActive(s.libraries, id) });
    scheduleAutosave(get);
  },

  loadConfigs: () => {
    if (!configsPromise) {
      configsPromise = (async () => {
        // One read of the whole table; records saved before figures existed are the legacy library.
        const allStored = await db.anatomy.toArray();
        const needsFigureStamp = allStored.some((a) => !isFigureId(a.figure));
        const stamped: AnatomyRecord[] = allStored.map((a) =>
          isFigureId(a.figure) ? a : { ...a, figure: "legacy" as FigureId }
        );
        if (needsFigureStamp) await db.anatomy.bulkPut(stamped);

        const loaded = await Promise.all(
          FIGURE_ORDER.map(async (id) => [id, await loadFigureLibrary(id, stamped.filter((a) => a.figure === id))] as const)
        );
        const libraries = emptyLibraries();
        loaded.forEach(([id, lib]) => {
          libraries[id] = lib;
        });
        // Read the figure *now*: hydrateFromDB may have switched it while the files loaded.
        set(withActive(libraries, get().figure));
      })().catch((err) => {
        configsPromise = null;
        throw err;
      });
    }
    return configsPromise;
  },

  hydrateFromDB: async () => {
    const [electrodes, sketches, texts, session] = await Promise.all([
      db.electrodes.orderBy("order").toArray(),
      db.sketches.toArray(),
      db.texts.toArray(),
      db.session.get("current"),
    ]);
    // A saved session remembers its figure. Sessions saved before figures existed have no
    // figure field and were all made on the legacy figure. With no session at all, keep the
    // figure already chosen (the saved preference, or the default).
    const hasData = electrodes.length > 0 || sketches.length > 0 || texts.length > 0;
    const figure: FigureId = session ? (isFigureId(session.figure) ? session.figure : "legacy") : hasData ? "legacy" : get().figure;
    set({
      electrodes,
      sketches,
      texts,
      patientLabel: session?.patientLabel ?? "",
      planNotes: session?.planNotes ?? "",
      hydrated: true,
      figure,
      ...withActive(get().libraries, figure),
    });
  },

  addLateralMedial: (partial) => {
    const s = get();
    const electrode: LateralMedialElectrode = {
      id: uuid(),
      name: partial?.name ?? "NEW1",
      type: "lateral-medial",
      color: partial?.color ?? nextColor(s.electrodes),
      entry: partial?.entry ?? { x: 0.25, y: 0.25 },
      target: partial?.target ?? { x: 0.25, y: 0.75 },
      entryName: partial?.entryName ?? "",
      targetName: partial?.targetName ?? "",
      notes: partial?.notes ?? "",
      showTarget: partial?.showTarget ?? true,
      order: s.electrodes.length,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    const before = cloneSnapshot(s);
    set({ electrodes: [...s.electrodes, electrode] });
    if (!historyBatch) pushHistory(set, get, before);
    scheduleAutosave(get);
    return electrode;
  },

  addSuperiorInferior: (partial) => {
    const s = get();
    const electrode: SuperiorInferiorElectrode = {
      id: uuid(),
      name: partial?.name ?? "NEW1",
      type: "superior-inferior",
      color: partial?.color ?? nextColor(s.electrodes),
      lateralStart: partial?.lateralStart ?? { x: 0.5, y: 0.1 },
      lateralEnd: partial?.lateralEnd ?? { x: 0.5, y: 0.3 },
      ...(partial?.medialTarget ? { medialTarget: partial.medialTarget } : {}),
      entryName: partial?.entryName ?? "",
      targetName: partial?.targetName ?? "",
      notes: partial?.notes ?? "",
      showTarget: partial?.showTarget ?? true,
      order: s.electrodes.length,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    const before = cloneSnapshot(s);
    set({ electrodes: [...s.electrodes, electrode] });
    if (!historyBatch) pushHistory(set, get, before);
    scheduleAutosave(get);
    return electrode;
  },

  addGrid: (partial) => {
    const s = get();
    const rows = Math.max(1, Math.round(partial?.rows ?? 1));
    const cols = Math.max(1, Math.round(partial?.cols ?? 4));
    const size = defaultGridSize(rows, cols);
    // Stagger successive arrays so a second one isn't hidden underneath the first.
    const placed = s.electrodes.filter((e) => e.type === "grid").length;
    const electrode: GridElectrode = {
      id: uuid(),
      name: partial?.name ?? `GRID${placed + 1}`,
      type: "grid",
      color: partial?.color ?? nextColor(s.electrodes),
      rows,
      cols,
      center: partial?.center ?? {
        x: Math.min(0.9, 0.18 + placed * 0.035),
        y: Math.min(0.9, 0.2 + placed * 0.035),
      },
      width: partial?.width ?? size.width,
      height: partial?.height ?? size.height,
      rotation: partial?.rotation ?? 0,
      contactNumbers: partial?.contactNumbers ?? true,
      entryName: partial?.entryName ?? "",
      targetName: partial?.targetName ?? "",
      notes: partial?.notes ?? "",
      showTarget: partial?.showTarget ?? true,
      order: s.electrodes.length,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    const before = cloneSnapshot(s);
    set({ electrodes: [...s.electrodes, electrode] });
    if (!historyBatch) pushHistory(set, get, before);
    scheduleAutosave(get);
    return electrode;
  },

  addByName: (rawName, mode = "lateral-medial") => {
    const s = get();
    const name = rawName.trim().toUpperCase();
    if (!name) return { ok: false, message: "Enter a name." };
    if (isNameTaken(name, s.electrodes)) {
      return { ok: false, message: `"${name}" is already in use.` };
    }

    // Try the anatomical library first (exact electrode-name match) -- gives a precise,
    // curated position plus entry/target labels, rather than a generic grid estimate.
    const libraryMatch = s.anatomy.find((a) => (a.electrodeName || "").trim().toUpperCase() === name);
    if (libraryMatch && s.regions) {
      const target = pixelToNormalized(libraryMatch.targetX, libraryMatch.targetY, s.regions);
      const entry = pixelToNormalized(libraryMatch.entryX, libraryMatch.entryY, s.regions);
      const created = s.addLateralMedial({
        name,
        entry,
        target,
        entryName: libraryMatch.preferredEntry,
        targetName: libraryMatch.targetName,
      });
      set({ selectedId: created.id });
      return { ok: true, message: `Placed ${name} from the anatomical library (${libraryMatch.targetName}).` };
    }

    // Use the superior-inferior config only when explicitly requested. The
    // anatomical library above always takes precedence because it is curated.
    if (mode === "superior-inferior" && s.siRegions && s.siRegions[name] && s.regions) {
      const anchor = s.siRegions[name];
      const { referenceWidth: rw, referenceHeight: rh } = s.regions;
      const toN = (p: [number, number]) => pixelToNormalized(p[0], p[1], s.regions!);
      const created = s.addSuperiorInferior({
        name,
        lateralStart: toN(anchor.lateralStart),
        lateralEnd: toN(anchor.lateralEnd),
        entryName: anchor.preferredEntry ?? "",
        targetName: anchor.targetName ?? "",
      });
      void rw; void rh;
      set({ selectedId: created.id });
      return { ok: true, message: `Placed ${name} from the superior-inferior config.` };
    }

    // Otherwise try lateral-medial 4-letter parsing when orthogonal placement is selected.
    const parsed = mode === "lateral-medial" ? parseLateralMedialName(name) : null;
    if (parsed && s.regions) {
      const quadKeyLateral = parsed.side === "L" ? "leftLateral" : "rightLateral";
      const quadKeyMedial = parsed.side === "L" ? "leftMedial" : "rightMedial";
      const col = parsed.amp === "A" ? 0 : parsed.amp === "M" ? 1 : 2;
      const row = parsed.smi === "S" ? 0 : parsed.smi === "M" ? 1 : 2;
      const entry = gridPositionInQuadrant(s.regions.quadrants[quadKeyLateral], col as 0 | 1 | 2, row as 0 | 1 | 2, s.regions);
      const target = gridPositionInQuadrant(s.regions.quadrants[quadKeyMedial], col as 0 | 1 | 2, row as 0 | 1 | 2, s.regions);
      const created = s.addLateralMedial({
        name: buildLateralMedialName(parsed.side, parsed.lobe, parsed.amp, parsed.smi),
        entry,
        target,
      });
      set({ selectedId: created.id });
      return {
        ok: true,
        message: `Placed ${name} using the approximate region grid -- verify placement before use.`,
      };
    }

    // Fallback: allow free-form names that don't fit the standard nomenclature
    // (e.g. an electrode named for a lesion it passes through). Placed manually.
    const created =
      mode === "superior-inferior"
        ? s.addSuperiorInferior({ name })
        : s.addLateralMedial({ name });
    set({ selectedId: created.id });
    return {
      ok: true,
      message:
        mode === "superior-inferior"
          ? `Added "${name}" as a superior-inferior electrode -- drag the entry (●) and target (✕) markers into place.`
          : `Added "${name}" manually -- drag the entry (●) and target (✕) markers into place.`,
    };
  },

  mirrorElectrode: (id) => {
    const s = get();
    const source = s.electrodes.find((e) => e.id === id);
    if (!source) return { ok: false, message: "Select an electrode first." };
    const name = source.name.trim().toUpperCase();
    if (!/^[LR]/.test(name)) {
      return { ok: false, message: `"${source.name}" does not have an L/R hemisphere prefix.` };
    }
    const mirroredName = `${name[0] === "L" ? "R" : "L"}${name.slice(1)}`;
    if (isNameTaken(mirroredName, s.electrodes)) {
      return { ok: false, message: `Cannot mirror ${name}: ${mirroredName} is already in the plan.` };
    }

    const libraryMatch = s.anatomy.find(
      (a) => (a.electrodeName || "").trim().toUpperCase() === mirroredName
    );

    const before = cloneSnapshot(s);
    let created: Electrode;
    historyBatch = { before };
    if (source.type === "lateral-medial") {
      if (libraryMatch && s.regions) {
        created = s.addLateralMedial({
          name: mirroredName,
          color: source.color,
          entry: pixelToNormalized(libraryMatch.entryX, libraryMatch.entryY, s.regions),
          target: pixelToNormalized(libraryMatch.targetX, libraryMatch.targetY, s.regions),
          entryName: libraryMatch.preferredEntry,
          targetName: libraryMatch.targetName,
          notes: source.notes,
        });
      } else {
        created = s.addLateralMedial({
          name: mirroredName,
          color: source.color,
          entry: { x: 1 - source.entry.x, y: source.entry.y },
          target: { x: 1 - source.target.x, y: source.target.y },
          entryName: source.entryName,
          targetName: source.targetName,
          notes: source.notes,
        });
      }
    } else if (source.type === "grid") {
      // Grids/strips mirror geometrically: the center reflects across the midline and
      // the rotation flips sign, so the array keeps its shape on the other side.
      created = s.addGrid({
        name: mirroredName,
        color: source.color,
        rows: source.rows,
        cols: source.cols,
        center: { x: 1 - source.center.x, y: source.center.y },
        width: source.width,
        height: source.height,
        rotation: -source.rotation,
        contactNumbers: source.contactNumbers,
        entryName: source.entryName,
        targetName: source.targetName,
        notes: source.notes,
      });
    } else {
      // Superior-inferior electrodes are mirrored geometrically. The lateral
      // superior/inferior trajectory points (and any medial target) flip in X.
      created = s.addSuperiorInferior({
        name: mirroredName,
        color: source.color,
        lateralStart: { x: 1 - source.lateralStart.x, y: source.lateralStart.y },
        lateralEnd: { x: 1 - source.lateralEnd.x, y: source.lateralEnd.y },
        medialTarget: source.medialTarget
          ? { x: 1 - source.medialTarget.x, y: source.medialTarget.y }
          : undefined,
        showTarget: source.showTarget,
        entryName: source.entryName,
        targetName: source.targetName,
        notes: source.notes,
      });
    }
    // Carry the Axial view placement across, reflected on the same view. Still inside the
    // history batch, so the mirror stays a single undo step.
    if (source.axial) {
      get().updateElectrode(created.id, {
        axial: mirrorAxial(normalizeAxial(source.axial), AXIAL_VIEWS[source.axial.view]),
      });
    }
    historyBatch = null;
    pushHistory(set, get, before);
    set({ selectedId: created.id });
    return {
      ok: true,
      message: libraryMatch
        ? `Mirrored ${name} to ${mirroredName} using the contralateral anatomical-library coordinates.`
        : `Mirrored ${name} to ${mirroredName} using geometric reflection across the midline.`,
    };
  },

  addByAnatomy: (record) => {
    const s = get();
    if (!s.regions) return;
    const target = pixelToNormalized(record.targetX, record.targetY, s.regions);
    const entry = pixelToNormalized(record.entryX, record.entryY, s.regions);
    // suggest a name from the target's hemisphere, guessed from x position
    const side: "L" | "R" = record.targetX < s.regions.referenceWidth / 2 ? "L" : "R";
    let suggested = `${side}${record.targetName.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, "X")}`;
    let n = 1;
    while (isNameTaken(suggested, s.electrodes)) {
      suggested = `${side}${record.targetName.slice(0, 2).toUpperCase().replace(/[^A-Z]/g, "X")}${n}`;
      n++;
    }
    const created = s.addLateralMedial({
      name: suggested,
      entry,
      target,
      entryName: record.preferredEntry,
      targetName: record.targetName,
    });
    set({ selectedId: created.id });
  },

  updateElectrode: (id, patch) => {
    const s = get();
    const before = cloneSnapshot(s);
    set({
      electrodes: s.electrodes.map((e) =>
        e.id === id ? ({ ...e, ...patch, updatedAt: nowISO() } as Electrode) : e
      ),
    });
    if (!historyBatch) pushHistory(set, get, before);
    scheduleAutosave(get);
  },

  renameElectrode: (id, name) => {
    const s = get();
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, message: "Name can't be empty." };
    if (isNameTaken(trimmed, s.electrodes, id)) {
      return { ok: false, message: `"${trimmed}" is already in use.` };
    }
    s.updateElectrode(id, { name: trimmed } as Partial<Electrode>);
    return { ok: true, message: "Renamed." };
  },

  removeElectrode: (id) => {
    const s = get();
    const before = cloneSnapshot(s);
    const remaining = s.electrodes
      .filter((e) => e.id !== id)
      .map((e, i) => ({ ...e, order: i }));
    set({ electrodes: remaining, selectedId: s.selectedId === id ? null : s.selectedId });
    if (!historyBatch) pushHistory(set, get, before);
    scheduleAutosave(get);
  },

  reorderElectrodes: (orderedIds) => {
    const s = get();
    const byId = new Map(s.electrodes.map((e) => [e.id, e]));
    const reordered = orderedIds
      .map((id, i) => {
        const e = byId.get(id);
        return e ? { ...e, order: i } : null;
      })
      .filter(Boolean) as Electrode[];
    const before = cloneSnapshot(s);
    set({ electrodes: reordered });
    if (!historyBatch) pushHistory(set, get, before);
    scheduleAutosave(get);
  },

  setSelected: (id) =>
    set({
      selectedId: id,
      selectedSketchId: id ? null : get().selectedSketchId,
      selectedTextId: id ? null : get().selectedTextId,
    }),
  setHovered: (id) => set({ hoveredId: id }),
  setSearchQuery: (q) => set({ searchQuery: q }),

  addSketch: (points) => {
    const s = get();
    if (points.length < 3) return;
    const sketch: FreehandSketch = {
      id: uuid(),
      label: `Area ${s.sketches.length + 1}`,
      points,
      color: s.sketchDraftColor,
      opacity: s.sketchDraftOpacity,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    const before = cloneSnapshot(s);
    set({ sketches: [...s.sketches, sketch], selectedSketchId: sketch.id });
    if (!historyBatch) pushHistory(set, get, before);
    scheduleAutosave(get);
  },

  duplicateSketch: (id) => {
    const s = get();
    const original = s.sketches.find((sk) => sk.id === id);
    if (!original) return;
    // Offset slightly so the copy doesn't sit exactly on top of the original, clamped to
    // stay within the image bounds (same rigid-translate logic used for dragging).
    const { x: dx, y: dy } = clampTranslation(original.points, 0.025, 0.025);
    const copy: FreehandSketch = {
      ...original,
      id: uuid(),
      label: `${original.label} copy`,
      points: original.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    const before = cloneSnapshot(s);
    set({ sketches: [...s.sketches, copy], selectedSketchId: copy.id });
    if (!historyBatch) pushHistory(set, get, before);
    scheduleAutosave(get);
  },

  updateSketch: (id, patch) => {
    const s = get();
    const before = cloneSnapshot(s);
    set({
      sketches: s.sketches.map((sk) => (sk.id === id ? { ...sk, ...patch, updatedAt: nowISO() } : sk)),
    });
    if (!historyBatch) pushHistory(set, get, before);
    scheduleAutosave(get);
  },

  removeSketch: (id) => {
    const s = get();
    const before = cloneSnapshot(s);
    set({
      sketches: s.sketches.filter((sk) => sk.id !== id),
      selectedSketchId: s.selectedSketchId === id ? null : s.selectedSketchId,
    });
    if (!historyBatch) pushHistory(set, get, before);
    scheduleAutosave(get);
  },

  addText: (position, content) => {
    const s = get();
    const text: TextAnnotation = {
      id: uuid(),
      content: (content ?? s.textDraft.content).trim() || "Text",
      position,
      color: s.textDraft.color,
      fontSize: s.textDraft.fontSize,
      bold: s.textDraft.bold,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    const before = cloneSnapshot(s);
    set({ texts: [...s.texts, text], selectedTextId: text.id, selectedId: null, selectedSketchId: null });
    if (!historyBatch) pushHistory(set, get, before);
    scheduleAutosave(get);
    return text;
  },

  updateText: (id, patch) => {
    const s = get();
    const before = cloneSnapshot(s);
    set({ texts: s.texts.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: nowISO() } : t)) });
    if (!historyBatch) pushHistory(set, get, before);
    scheduleAutosave(get);
  },

  duplicateText: (id) => {
    const s = get();
    const original = s.texts.find((t) => t.id === id);
    if (!original) return;
    const copy: TextAnnotation = {
      ...original,
      id: uuid(),
      position: {
        x: Math.min(1, original.position.x + 0.02),
        y: Math.min(1, original.position.y + 0.025),
      },
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    const before = cloneSnapshot(s);
    set({ texts: [...s.texts, copy], selectedTextId: copy.id });
    if (!historyBatch) pushHistory(set, get, before);
    scheduleAutosave(get);
  },

  removeText: (id) => {
    const s = get();
    const before = cloneSnapshot(s);
    set({
      texts: s.texts.filter((t) => t.id !== id),
      selectedTextId: s.selectedTextId === id ? null : s.selectedTextId,
    });
    if (!historyBatch) pushHistory(set, get, before);
    scheduleAutosave(get);
  },

  addAnatomyRecord: (rec, figure) => {
    const s = get();
    const fig = figure ?? s.figure;
    const lib = s.libraries[fig];
    // New manual entries go after everything already loaded from the file.
    const record: AnatomyRecord = { ...rec, id: uuid(), fileOrder: lib.anatomy.length, figure: fig };
    patchLibrary(set, get, fig, { anatomy: [...lib.anatomy, record] });
    void db.anatomy.put(record);
  },

  updateAnatomyRecord: (id, patch, figure) => {
    const s = get();
    const fig = figure ?? s.figure;
    const updated = s.libraries[fig].anatomy.map((a) => (a.id === id ? { ...a, ...patch, id: a.id, figure: fig } : a));
    patchLibrary(set, get, fig, { anatomy: updated });
    const rec = updated.find((a) => a.id === id);
    if (rec) void db.anatomy.put(rec);
  },

  removeAnatomyRecord: (id, figure) => {
    const s = get();
    const fig = figure ?? s.figure;
    patchLibrary(set, get, fig, { anatomy: s.libraries[fig].anatomy.filter((a) => a.id !== id) });
    void db.anatomy.delete(id);
  },

  replaceAnatomyLibrary: (records, figure) => {
    const fig = figure ?? get().figure;
    // Imported/replaced order becomes the new file order.
    const withIds: AnatomyRecord[] = records.map((r, idx) => ({ ...r, id: uuid(), fileOrder: idx, figure: fig }));
    patchLibrary(set, get, fig, { anatomy: withIds });
    // Only this figure's rows are replaced; the other figure's library is left alone.
    void db.transaction("rw", db.anatomy, async () => {
      await db.anatomy.filter((a) => (a.figure ?? "legacy") === fig).delete();
      await db.anatomy.bulkAdd(withIds);
    });
  },

  restoreShippedAnatomy: async (figure) => {
    const fig = figure ?? get().figure;
    const res = await fetchShipped(FIGURES[fig].libraryFile);
    const { records } = parseAnatomyCsv(await res.text());
    get().replaceAnatomyLibrary(records, fig);
    return records.length;
  },

  newPlan: async (figure) => {
    const fig = figure && isFigureId(figure) ? figure : get().figure;
    if (figure && isFigureId(figure)) saveFigurePref(fig);
    await db.transaction("rw", db.electrodes, db.session, db.sketches, db.texts, async () => {
      await db.electrodes.clear();
      await db.sketches.clear();
      await db.texts.clear();
      await db.session.clear();
      // Keep the chosen figure even if the page is reloaded before the first autosave.
      await db.session.put({ key: "current", patientLabel: "", planNotes: "", figure: fig, updatedAt: nowISO() });
    });
    historyBatch = null;
    set({
      figure: fig,
      ...withActive(get().libraries, fig),
      electrodes: [],
      sketches: [],
      texts: [],
      patientLabel: "",
      planNotes: "",
      selectedId: null,
      selectedSketchId: null,
      selectedTextId: null,
      undoStack: [],
      redoStack: [],
    });
  },

  loadPlanFile: (file) => {
    historyBatch = null;
    // Files written before figures existed have no figure field: they are legacy-figure plans.
    const figure: FigureId = isFigureId(file.figure) ? file.figure : "legacy";
    set({
      figure,
      ...withActive(get().libraries, figure),
      electrodes: file.electrodes,
      sketches: file.sketches ?? [],
      texts: file.texts ?? [],
      patientLabel: file.patientLabel ?? "",
      planNotes: file.planNotes ?? "",
      selectedId: null,
      selectedSketchId: null,
      selectedTextId: null,
      undoStack: [],
      redoStack: [],
    });
    scheduleAutosave(get);
  },

  exportPlanFile: () => {
    const s = get();
    const file: SeegPlanFile = {
      formatVersion: CURRENT_FORMAT_VERSION,
      appVersion: "1.0.0",
      createdAt: s.electrodes[0]?.createdAt ?? nowISO(),
      updatedAt: nowISO(),
      patientLabel: s.patientLabel,
      planNotes: s.planNotes,
      electrodes: s.electrodes,
      sketches: s.sketches,
      texts: s.texts,
      figure: s.figure,
    };
    return file;
  },

  setPatientLabel: (v) => {
    set({ patientLabel: v });
    scheduleAutosave(get);
  },
  setPlanNotes: (v) => {
    set({ planNotes: v });
    scheduleAutosave(get);
  },
}));
