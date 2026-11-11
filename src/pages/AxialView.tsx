import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import AxialCanvas from "../components/AxialCanvas";
import AxialElectrodeList from "../components/AxialElectrodeList";
import { AXIAL_VIEWS, AXIAL_VIEW_ORDER } from "../lib/axialViews";
import { SCHEMATIC_NOTE } from "../lib/axialStyle";
import { exportBaseName, exportWorkspacePng } from "../lib/export/png";
import { axialLegendEntries, exportAxialLegendPng } from "../lib/export/axialLegend";

/**
 * Axial view: each depth electrode's full shaft on a bottom-up or top-down outline, so
 * every contact can be marked as grey matter, white matter or outside the brain.
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
  const figureRef = useRef<HTMLDivElement>(null);
  const placedCount = axialLegendEntries(electrodes).length;

  /** Save the figure and its legend as two PNGs. */
  const runExport = async () => {
    if (!figureRef.current || placedCount === 0) return;
    const base = exportBaseName(patientLabel);
    setBusy(true);
    try {
      await exportWorkspacePng(figureRef.current, `${base}-axial`);
      await exportAxialLegendPng(electrodes, `${base}-axial-legend`);
      window.alert(
        `Saved ${base}-axial.png and ${base}-axial-legend.png.\n\n` +
          "If only one arrived, allow multiple downloads for this site and export again."
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
            Click a contact to cycle grey → white → outside. Drag to move; drag the ◆ to rotate.
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
            title={placedCount === 0 ? "Put at least one electrode on a view first" : "Saves the figure and a separate legend as two PNG files"}
          >
            {busy ? "Exporting…" : "Export PNG"}
          </button>
        </div>

        <div className="scroll" style={{ flex: 1, padding: 20, minHeight: 0 }}>
          {/* Centred by this wrapper, not by a margin on the captured node: the PNG capture copies
              computed margins and would shift the figure off its own canvas. */}
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div ref={figureRef} style={{ background: "#fff", padding: 16 }}>
            <div style={{ display: "flex", gap: 40, alignItems: "flex-start" }}>
              {AXIAL_VIEW_ORDER.map((v) => (
                <div key={v} style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ textAlign: "center", fontSize: 14, fontWeight: 700, marginBottom: 8, color: "#182430" }}>
                    {AXIAL_VIEWS[v].label}{" "}
                    <span style={{ fontWeight: 400, color: "#647480" }}>({AXIAL_VIEWS[v].caption})</span>
                  </div>
                  <AxialCanvas viewId={v} showAllNumbers={showAllNumbers} />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, fontSize: 11, color: "#647480", textAlign: "center" }}>{SCHEMATIC_NOTE}</div>
          </div>
          </div>
        </div>
      </div>
      <div style={{ width: 380, flexShrink: 0, borderLeft: "1px solid var(--line)", background: "var(--surface)" }}>
        <AxialElectrodeList />
      </div>
    </div>
  );
}
