import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import AxialCanvas from "../components/AxialCanvas";
import AxialElectrodeList from "../components/AxialElectrodeList";
import { AXIAL_VIEWS, AXIAL_VIEW_ORDER } from "../lib/axialViews";
import { normalizeAxial } from "../lib/axial";
import type { AxialViewId } from "../types";
import { exportBaseName, exportWorkspacePng } from "../lib/export/png";
import { axialLegendEntries, exportAxialLegendPng } from "../lib/export/axialLegend";

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
  const [busy, setBusy] = useState(false);
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

  /** Save each view in use as its own PNG, then the combined legend. */
  const runExport = async () => {
    if (placedCount === 0) return;
    const base = exportBaseName(patientLabel);
    setBusy(true);
    try {
      const saved: string[] = [];
      for (const v of usedViews) {
        const node = viewRefs.current[v];
        if (!node) continue;
        const name = `${base}-${AXIAL_VIEWS[v].fileSlug}`;
        await exportWorkspacePng(node, name);
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
      setBusy(false);
    }
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
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            Click a contact: grey → white → noisy. Set "Last in brain" in the list. Drag to move, ◆ to rotate, the
            edge bar to adjust the brain edge.
          </span>
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
          <button
            className="btn btn-sm btn-primary"
            disabled={busy || placedCount === 0}
            onClick={runExport}
            title={placedCount === 0 ? "Put at least one electrode on a view first" : "Saves each view as its own PNG with its legend, plus a combined legend"}
          >
            {busy ? "Exporting…" : "Export PNG"}
          </button>
        </div>

        <div className="scroll" style={{ flex: 1, padding: 20, minHeight: 0 }}>
          {usedViews.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", marginTop: 40 }}>
              Choose a view for an electrode in the list to show it here.
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
                gap: 20,
                maxWidth: 1400,
                margin: "0 auto",
              }}
            >
              {usedViews.map((v) => (
                // The border sits on this wrapper, outside the captured node, so it isn't exported.
                <div key={v} style={{ border: "1px solid #cbd3da", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
                  <div
                    ref={(el) => {
                      viewRefs.current[v] = el;
                    }}
                    data-view={v}
                    style={{ background: "#fff" }}
                  >
                    <AxialCanvas viewId={v} showAllNumbers={showAllNumbers} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ width: 380, flexShrink: 0, borderLeft: "1px solid var(--line)", background: "var(--surface)" }}>
        <AxialElectrodeList />
      </div>
    </div>
  );
}
