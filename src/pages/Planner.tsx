import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import BrainCanvas from "../components/BrainCanvas";
import ElectrodePanel from "../components/ElectrodePanel";
import { exportBaseName, exportWorkspacePng } from "../lib/export/png";
import { exportWorkspacePdf } from "../lib/export/pdf";
import { exportWorkspacePptx } from "../lib/export/pptx";
import { saveSeegmapFile } from "../lib/export/seegmap";
import { REF_W } from "../lib/constants";
import { FIGURES } from "../lib/figures";
import FigureSegmented from "../components/FigureSegmented";
import { useCanvasHeight } from "../lib/useFigure";
import type { FigureId } from "../types";

/** localStorage key for the "Legend" export tick box (a per-browser convenience). */
const LEGEND_PREF_KEY = "seegmap.exportLegend";

export default function Planner() {
  const electrodes = useStore((s) => s.electrodes);
  const sketches = useStore((s) => s.sketches);
  const texts = useStore((s) => s.texts);
  const patientLabel = useStore((s) => s.patientLabel);
  const planNotes = useStore((s) => s.planNotes);
  const setPatientLabel = useStore((s) => s.setPatientLabel);
  const setPlanNotes = useStore((s) => s.setPlanNotes);
  const exportPlanFile = useStore((s) => s.exportPlanFile);
  const showNames = useStore((s) => s.showNames);
  const toggleShowNames = useStore((s) => s.toggleShowNames);
  const drawMode = useStore((s) => s.drawMode);
  const setDrawMode = useStore((s) => s.setDrawMode);
  const sketchDraftColor = useStore((s) => s.sketchDraftColor);
  const sketchDraftOpacity = useStore((s) => s.sketchDraftOpacity);
  const setSketchDraft = useStore((s) => s.setSketchDraft);
  const textMode = useStore((s) => s.textMode);
  const setTextMode = useStore((s) => s.setTextMode);
  const textDraft = useStore((s) => s.textDraft);
  const setTextDraft = useStore((s) => s.setTextDraft);
  const selectedTextId = useStore((s) => s.selectedTextId);
  const setSelectedTextId = useStore((s) => s.setSelectedTextId);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const undoCount = useStore((s) => s.undoStack.length);
  const redoCount = useStore((s) => s.redoStack.length);
  const nudgeSelection = useStore((s) => s.nudgeSelection);
  const selectedId = useStore((s) => s.selectedId);
  const selectedSketchId = useStore((s) => s.selectedSketchId);
  const setSelected = useStore((s) => s.setSelected);
  const setSelectedSketchId = useStore((s) => s.setSelectedSketchId);
  const figure = useStore((s) => s.figure);
  const REF_H = useCanvasHeight();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;

      if (e.key === "Escape") {
        setSelected(null);
        setSelectedSketchId(null);
        setSelectedTextId(null);
        useStore.getState().setTextMode(false);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          if (e.shiftKey) redo(); else undo();
          return;
        }
        if (e.key.toLowerCase() === "y") {
          e.preventDefault();
          redo();
          return;
        }
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId || selectedSketchId || selectedTextId) {
          e.preventDefault();
          if (selectedId) useStore.getState().removeElectrode(selectedId);
          else if (selectedSketchId) useStore.getState().removeSketch(selectedSketchId);
          else if (selectedTextId) useStore.getState().removeText(selectedTextId);
        }
        return;
      }
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
      };
      const delta = arrows[e.key];
      if (delta && (selectedId || selectedSketchId || selectedTextId)) {
        e.preventDefault();
        const pixels = e.shiftKey ? 10 : 2;
        nudgeSelection((delta[0] * pixels) / REF_W, (delta[1] * pixels) / REF_H);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    nudgeSelection,
    REF_H,
    redo,
    selectedId,
    selectedSketchId,
    selectedTextId,
    setSelected,
    setSelectedSketchId,
    setSelectedTextId,
    undo,
  ]);

  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(340);
  const resizingRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const PANEL_MIN = 260;
  const PANEL_MAX = 640;

  const onResizePointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    resizingRef.current = { startX: e.clientX, startWidth: panelWidth };
  };
  const onResizePointerMove = (e: React.PointerEvent) => {
    if (!resizingRef.current) return;
    const delta = resizingRef.current.startX - e.clientX; // dragging left grows the panel
    const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, resizingRef.current.startWidth + delta));
    setPanelWidth(next);
  };
  const onResizePointerUp = () => {
    resizingRef.current = null;
  };

  const [includeLegend, setIncludeLegendState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LEGEND_PREF_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setIncludeLegend = (v: boolean) => {
    setIncludeLegendState(v);
    try {
      localStorage.setItem(LEGEND_PREF_KEY, v ? "1" : "0");
    } catch {
      // Storage unavailable (private window etc.): the choice lasts for this page only.
    }
  };

  const baseFilename = () => exportBaseName(patientLabel);

  const runExport = async (kind: "png" | "pdf" | "pptx") => {
    if (!canvasWrapRef.current) return;
    setBusy(kind);
    try {
      if (kind === "png") {
        await exportWorkspacePng(canvasWrapRef.current, baseFilename(), includeLegend ? electrodes : undefined);
      } else if (kind === "pdf") {
        await exportWorkspacePdf({
          node: canvasWrapRef.current,
          electrodes,
          patientLabel,
          planNotes,
          filename: baseFilename(),
          includeLegend,
        });
      } else {
        await exportWorkspacePptx({
          figure,
          electrodes,
          sketches,
          texts,
          patientLabel,
          planNotes,
          showNames,
          filename: baseFilename(),
        });
      }
    } catch (err) {
      console.error(err);
      window.alert("Export failed. See console for details.");
    } finally {
      setBusy(null);
    }
  };

  const handleSaveSeegmap = () => {
    const file = exportPlanFile();
    saveSeegmapFile(file, baseFilename());
  };

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
          <input
            value={patientLabel}
            onChange={(e) => setPatientLabel(e.target.value)}
            placeholder="Patient / case label (not stored in cloud)"
            style={{
              border: "1px solid var(--line-strong)",
              borderRadius: 8,
              padding: "7px 10px",
              fontSize: 13,
              width: 240,
            }}
          />
          <button className="btn btn-sm" onClick={() => setNotesOpen((v) => !v)}>
            Plan Notes
          </button>
          <ToggleButton active={showNames} onClick={toggleShowNames}>
            Show Names
          </ToggleButton>
          <FigureToggle />
          <ToggleButton active={drawMode} onClick={() => setDrawMode(!drawMode)}>
            ✏️ Draw Area
          </ToggleButton>
          {drawMode && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-2)", padding: "5px 10px", borderRadius: 8 }}>
              <input
                type="color"
                value={sketchDraftColor}
                onChange={(e) => setSketchDraft({ color: e.target.value })}
                style={{ width: 28, height: 24, padding: 1, cursor: "pointer" }}
                title="Sketch color"
              />
              <input
                type="range"
                min={0.1}
                max={0.8}
                step={0.05}
                value={sketchDraftOpacity}
                onChange={(e) => setSketchDraft({ opacity: Number(e.target.value) })}
                title="Sketch opacity"
                style={{ width: 80 }}
              />
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Trace freehand on canvas</span>
            </div>
          )}
          <ToggleButton active={textMode} onClick={() => setTextMode(!textMode)}>
            T Add Text
          </ToggleButton>
          {textMode && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-2)", padding: "5px 10px", borderRadius: 8 }}>
              <input
                value={textDraft.content}
                onChange={(e) => setTextDraft({ content: e.target.value })}
                placeholder="Label text"
                style={{
                  border: "1px solid var(--line-strong)",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 12.5,
                  width: 150,
                }}
              />
              <input
                type="color"
                value={textDraft.color}
                onChange={(e) => setTextDraft({ color: e.target.value })}
                style={{ width: 28, height: 24, padding: 1, cursor: "pointer" }}
                title="Text color"
              />
              <input
                type="range"
                min={12}
                max={72}
                step={1}
                value={textDraft.fontSize}
                onChange={(e) => setTextDraft({ fontSize: Number(e.target.value) })}
                title="Text size"
                style={{ width: 70 }}
              />
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Click the canvas to place</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 5 }} title="Undo / redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z)">
            <button className="btn btn-sm" disabled={undoCount === 0} onClick={undo}>↶ Undo</button>
            <button className="btn btn-sm" disabled={redoCount === 0} onClick={redo}>↷ Redo</button>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={handleSaveSeegmap}>
            Save .seegmap
          </button>
          <label
            title="Draw a table of electrode names, entries and targets beside the figure in PNG and PDF exports"
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <input
              type="checkbox"
              checked={includeLegend}
              onChange={(e) => setIncludeLegend(e.target.checked)}
              style={{ width: 14, height: 14, cursor: "pointer" }}
            />
            Legend
          </label>
          <button className="btn btn-sm" disabled={busy !== null} onClick={() => runExport("png")}>
            {busy === "png" ? "Exporting…" : "Export PNG"}
          </button>
          <button className="btn btn-sm" disabled={busy !== null} onClick={() => runExport("pdf")}>
            {busy === "pdf" ? "Exporting…" : "Export PDF"}
          </button>
          <button className="btn btn-sm btn-primary" disabled={busy !== null} onClick={() => runExport("pptx")}>
            {busy === "pptx" ? "Exporting…" : "Export PPTX"}
          </button>
        </div>

        {notesOpen && (
          <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }}>
            <textarea
              value={planNotes}
              onChange={(e) => setPlanNotes(e.target.value)}
              placeholder="Plan-level notes (included on the Notes export page/slide)"
              rows={3}
              style={{
                width: "100%",
                maxWidth: 900,
                border: "1px solid var(--line-strong)",
                borderRadius: 8,
                padding: 10,
                fontSize: 13,
                resize: "vertical",
              }}
            />
          </div>
        )}

        <div className="scroll" style={{ flex: 1, padding: 20, minHeight: 0 }}>
          <div ref={canvasWrapRef} style={{ background: "#fff", display: "inline-block", width: "100%" }}>
            <BrainCanvas />
          </div>
        </div>
      </div>

      <div
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerLeave={onResizePointerUp}
        title="Drag to resize"
        style={{
          width: 6,
          flexShrink: 0,
          cursor: "col-resize",
          background: "var(--line)",
          touchAction: "none",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent)")}
        onMouseLeave={(e) => {
          if (!resizingRef.current) e.currentTarget.style.background = "var(--line)";
        }}
      />
      <div style={{ width: panelWidth, flexShrink: 0, borderLeft: "1px solid var(--line)", background: "var(--surface)" }}>
        <ElectrodePanel />
      </div>
    </div>
  );
}

/** Switch between the brain figures. Each plan remembers which figure it was made on. */
function FigureToggle() {
  const figure = useStore((s) => s.figure);
  const setFigure = useStore((s) => s.setFigure);
  const hasContent = useStore((s) => s.electrodes.length + s.sketches.length + s.texts.length > 0);

  const choose = (id: FigureId) => {
    if (id === figure) return;
    if (
      hasContent &&
      !window.confirm(
        `Switch to the ${FIGURES[id].label.toLowerCase()}?\n\n` +
          "Your electrodes, areas and text keep the same relative positions on the image, but the two " +
          "figures are drawn differently, so markers will not sit on the same anatomy. Review their " +
          "placement after switching. You can switch back at any time."
      )
    ) {
      return;
    }
    setFigure(id);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }} title="Brain figure used for this plan">
      <span style={{ fontSize: 12, color: "var(--muted)" }}>Figure</span>
      <FigureSegmented value={figure} onChange={choose} />
    </div>
  );
}

function ToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="btn btn-sm"
      onClick={onClick}
      style={{
        background: active ? "var(--accent)" : "var(--surface)",
        borderColor: active ? "var(--accent)" : "var(--line-strong)",
        color: active ? "var(--accent-ink)" : "var(--ink)",
      }}
    >
      {children}
    </button>
  );
}
