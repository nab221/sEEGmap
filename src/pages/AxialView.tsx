import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import AxialCanvas, { type Marking } from "../components/AxialCanvas";
import AxialElectrodeList from "../components/AxialElectrodeList";
import { AXIAL_VIEWS, AXIAL_VIEW_ORDER } from "../lib/axialViews";
import { normalizeAxial } from "../lib/axial";
import type { AxialViewId } from "../types";
import { exportBaseName } from "../lib/export/png";
import { exportElectrodeViewPdf, exportElectrodeViewPng, type ElectrodeViewPage } from "../lib/export/electrodeViewPng";
import { axialLegendEntries, exportAxialLegendPng } from "../lib/export/axialLegend";

/** Zoom = each view's width as a percentage of the drawing area; 100% is one view per row. */
const ZOOM_MIN = 20;
const ZOOM_MAX = 200;
const ZOOM_STEP = 5;
const ZOOM_DEFAULT = 50;
/** Space between views, and padding round them, in CSS px. */
const VIEW_GAP = 20;
const ZOOM_KEY = "seegmap.electrodeView.zoom";

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z / ZOOM_STEP) * ZOOM_STEP));

function loadZoom(): number {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY));
    return Number.isFinite(v) && v > 0 ? clampZoom(v) : ZOOM_DEFAULT;
  } catch {
    return ZOOM_DEFAULT;
  }
}

/** Frame aspect (height / width) of a view as AxialCanvas draws it, margins included. */
function frameAspect(v: AxialViewId): number {
  const c = AXIAL_VIEWS[v];
  return (c.height * (1 + 2 * c.margin.y)) / (c.width * (1 + 2 * c.margin.x));
}

/**
 * Electrode view: after implantation, each depth electrode's shaft on the outline that
 * shows it best, so every contact can be marked grey matter, white matter, noisy or
 * outside the brain. Only views with an electrode on them are shown.
 */
export default function AxialView() {
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const undoCount = useStore((s) => s.undoStack.length);
  const redoCount = useStore((s) => s.redoStack.length);
  const electrodes = useStore((s) => s.electrodes);
  const patientLabel = useStore((s) => s.patientLabel);
  const [showAllNumbers, setShowAllNumbers] = useState(false);
  const [busy, setBusy] = useState<"png" | "pdf" | null>(null);
  const [zoom, setZoomState] = useState(loadZoom);
  const [marking, setMarking] = useState<Marking | null>(null);
  const markingName = marking ? electrodes.find((e) => e.id === marking.electrodeId)?.name : undefined;
  // Stop marking if its electrode is deleted or taken off every view.
  useEffect(() => {
    if (!marking) return;
    const e = electrodes.find((x) => x.id === marking.electrodeId);
    if (!e || e.type === "grid" || !normalizeAxial(e.axial)) setMarking(null);
  }, [electrodes, marking]);
  useEffect(() => {
    if (!marking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMarking(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [marking]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const setZoom = (z: number) => {
    const next = clampZoom(z);
    setZoomState(next);
    try {
      localStorage.setItem(ZOOM_KEY, String(next));
    } catch {
      // Storage blocked: the zoom just isn't remembered.
    }
  };
  const viewRefs = useRef<Partial<Record<AxialViewId, HTMLDivElement | null>>>({});
  const placedCount = axialLegendEntries(electrodes).length;
  const usedViews = useMemo(() => {
    const used = new Set(
      electrodes.flatMap((e) => {
        const p = e.type !== "grid" ? normalizeAxial(e.axial) : null;
        return p ? [p.view] : [];
      })
    );
    return AXIAL_VIEW_ORDER.filter((v) => used.has(v));
  }, [electrodes]);

  /** Each view in use with its node and legend entries, in display order. */
  const exportViews = (): (ElectrodeViewPage & { slug: string })[] =>
    usedViews.flatMap((v) => {
      const node = viewRefs.current[v];
      return node ? [{ node, entries: axialLegendEntries(electrodes, v), slug: AXIAL_VIEWS[v].fileSlug }] : [];
    });

  /** PNG: each view in use as its own page, then the combined legend. PDF: every view, one page each. */
  const runExport = async (kind: "png" | "pdf") => {
    if (placedCount === 0) return;
    const base = exportBaseName(patientLabel);
    setBusy(kind);
    try {
      if (kind === "pdf") {
        await exportElectrodeViewPdf(exportViews(), patientLabel, `${base}-electrode-views`);
        return;
      }
      const saved: string[] = [];
      for (const view of exportViews()) {
        const name = `${base}-${view.slug}`;
        await exportElectrodeViewPng(view, patientLabel, name);
        saved.push(`${name}.png`);
      }
      await exportAxialLegendPng(electrodes, `${base}-electrode-legend`);
      saved.push(`${base}-electrode-legend.png`);
      window.alert(
        `Saved ${saved.join(", ")}.\n\n` +
          "If some are missing, allow multiple downloads for this site and export again."
      );
    } catch (err) {
      console.error(err);
      window.alert("Export failed. See console for details.");
    } finally {
      setBusy(null);
    }
  };

  /** Largest zoom at which every view in use fits the visible area at once, without scrolling. */
  const fitZoom = () => {
    const el = scrollRef.current;
    if (!el || usedViews.length === 0) return;
    const areaW = el.clientWidth - 2 * VIEW_GAP;
    // The app shell grows with its content, so the window, not this box, bounds what's visible.
    const visibleH = Math.min(el.clientHeight, window.innerHeight - Math.max(0, el.getBoundingClientRect().top));
    const areaH = visibleH - 2 * VIEW_GAP;
    const aspects = usedViews.map(frameAspect);
    // Lay the views out as the flex row below does, from 100% down, until they fit.
    for (let z = 100; z >= ZOOM_MIN; z -= ZOOM_STEP) {
      const cardW = (z / 100) * areaW - VIEW_GAP * (1 - z / 100);
      const perRow = Math.max(1, Math.floor((areaW + VIEW_GAP + 0.5) / (cardW + VIEW_GAP)));
      let total = 0;
      for (let i = 0; i < aspects.length; i += perRow) {
        total += Math.max(...aspects.slice(i, i + perRow)) * cardW + 2 + (i > 0 ? VIEW_GAP : 0); // 2: card border
      }
      if (total <= areaH) {
        setZoom(z);
        return;
      }
    }
    setZoom(ZOOM_MIN);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 20px",
            borderBottom: "1px solid var(--line)",
            background: "var(--surface)",
            flexWrap: "wrap",
          }}
        >
          {marking ? (
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent, #1976d2)" }}>
              {marking.step === "target"
                ? `Click the target (contact 1) for ${markingName ?? "the electrode"}.`
                : `Now click where ${markingName ?? "it"} enters the brain.`}{" "}
              Esc to cancel.
            </span>
          ) : (
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              Click a contact: grey → white → noisy. Set "Last in brain" in the list. Drag to move, ◆ to rotate, the
              dashed entry bar to set where the shaft enters the brain (the contacts stretch to fill it).
            </span>
          )}
          <div style={{ display: "flex", gap: 5 }} title="Undo / redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z)">
            <button className="btn btn-sm" disabled={undoCount === 0} onClick={undo}>↶ Undo</button>
            <button className="btn btn-sm" disabled={redoCount === 0} onClick={redo}>↷ Redo</button>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
            <input
              type="checkbox"
              checked={showAllNumbers}
              onChange={(e) => setShowAllNumbers(e.target.checked)}
              style={{ width: 14, height: 14, cursor: "pointer" }}
            />
            Show all contact numbers
          </label>
          <div style={{ flex: 1 }} />
          <div
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, whiteSpace: "nowrap" }}
            title="Size of each view. 100% fills the width with one view per row."
          >
            <label htmlFor="ev-zoom" style={{ color: "var(--muted)" }}>Zoom</label>
            <button className="btn btn-sm" onClick={() => setZoom(zoom - ZOOM_STEP * 2)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out">
              −
            </button>
            <input
              id="ev-zoom"
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={ZOOM_STEP}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{ width: 120, cursor: "pointer" }}
            />
            <button className="btn btn-sm" onClick={() => setZoom(zoom + ZOOM_STEP * 2)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in">
              +
            </button>
            <span style={{ width: 36, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{zoom}%</span>
            <button
              className="btn btn-sm"
              onClick={fitZoom}
              disabled={usedViews.length === 0}
              title="Zoom so every view fits in the window at once"
            >
              Fit
            </button>
          </div>
          <button
            className="btn btn-sm"
            disabled={busy !== null || placedCount === 0}
            onClick={() => runExport("png")}
            title={placedCount === 0 ? "Put at least one electrode on a view first" : "Saves each view as its own A4 PNG with its legend, plus a combined legend"}
          >
            {busy === "png" ? "Exporting…" : "Export PNG"}
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={busy !== null || placedCount === 0}
            onClick={() => runExport("pdf")}
            title={placedCount === 0 ? "Put at least one electrode on a view first" : "Saves one PDF with an A4 page per view, each with its legend"}
          >
            {busy === "pdf" ? "Exporting…" : "Export PDF"}
          </button>
        </div>

        <div ref={scrollRef} className="scroll" style={{ flex: 1, padding: VIEW_GAP, minHeight: 0, overflowX: "auto" }}>
          {usedViews.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", marginTop: 40 }}>
              Choose a view for an electrode in the list to show it here.
            </p>
          ) : (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                alignItems: "flex-start",
                gap: VIEW_GAP,
                // Above 100% the views are wider than the area: scroll sideways rather than squash.
                width: zoom > 100 ? `${zoom}%` : undefined,
              }}
            >
              {usedViews.map((v) => (
                // The border sits on this wrapper, outside the captured node, so it isn't exported.
                <div
                  key={v}
                  style={{
                    // z% of the row, less this card's share of the gaps, so 1/n zoom fits n per row.
                    width: zoom > 100 ? "100%" : `calc(${zoom}% - ${(VIEW_GAP * (1 - zoom / 100)).toFixed(2)}px)`,
                    boxSizing: "border-box",
                    border: "1px solid #cbd3da",
                    borderRadius: 8,
                    overflow: "hidden",
                    background: "#fff",
                  }}
                >
                  <div
                    ref={(el) => {
                      viewRefs.current[v] = el;
                    }}
                    data-view={v}
                    style={{ background: "#fff" }}
                  >
                    <AxialCanvas viewId={v} showAllNumbers={showAllNumbers} marking={marking} onMarking={setMarking} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ width: 380, flexShrink: 0, borderLeft: "1px solid var(--line)", background: "var(--surface)" }}>
        <AxialElectrodeList marking={marking} onMarking={setMarking} />
      </div>
    </div>
  );
}
