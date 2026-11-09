import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useStore } from "../store/useStore";
import type { Electrode } from "../types";
import { lateralToMedial } from "../lib/coords";

const GRIP = (
  <svg width="12" height="14" viewBox="0 0 14 14" fill="none">
    {[3, 7, 11].map((y) =>
      [4, 10].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.1} fill="var(--faint)" />)
    )}
  </svg>
);

const cellInputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 12,
  border: "1px solid var(--line)",
  borderRadius: 4,
  padding: "4px 6px",
  background: "var(--surface)",
};

export const ROW_GRID_COLUMNS = "14px 62px 1fr 1fr 18px 18px 22px";

export default function ElectrodeRow({
  electrode,
  checked,
  onToggleChecked,
}: {
  electrode: Electrode;
  checked: boolean;
  onToggleChecked: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: electrode.id,
  });
  const selectedId = useStore((s) => s.selectedId);
  const hoveredId = useStore((s) => s.hoveredId);
  const setSelected = useStore((s) => s.setSelected);
  const regions = useStore((s) => s.regions);
  const setHovered = useStore((s) => s.setHovered);
  const renameElectrode = useStore((s) => s.renameElectrode);
  const updateElectrode = useStore((s) => s.updateElectrode);
  const removeElectrode = useStore((s) => s.removeElectrode);

  const [moreOpen, setMoreOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(electrode.name);
  const [nameError, setNameError] = useState<string | null>(null);

  const isActive = electrode.id === selectedId || electrode.id === hoveredId;
  const isGrid = electrode.type === "grid";

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const commitName = () => {
    if (nameDraft.trim() === electrode.name) {
      setNameError(null);
      return;
    }
    const res = renameElectrode(electrode.id, nameDraft);
    if (!res.ok) {
      setNameError(res.message);
    } else {
      setNameError(null);
    }
  };

  const toggleSelect = () => setSelected(selectedId === electrode.id ? null : electrode.id);

  return (
    <div ref={setNodeRef} style={style}>
      <div
        onMouseEnter={() => setHovered(electrode.id)}
        onMouseLeave={() => setHovered(null)}
        onClick={toggleSelect}
        style={{
          display: "grid",
          gridTemplateColumns: ROW_GRID_COLUMNS,
          gap: 6,
          alignItems: "center",
          padding: "6px 8px",
          borderLeft: `${isActive ? 5 : 2}px solid ${electrode.color}`,
          borderBottom: "1px solid var(--line)",
          background: isActive ? "var(--accent-soft)" : "transparent",
          cursor: "pointer",
          transition: "border-left-width 0.1s ease, background 0.1s ease",
        }}
      >
        <span {...attributes} {...listeners} style={{ cursor: "grab", display: "flex", touchAction: "none" }}>
          {GRIP}
        </span>

        <input
          className="mono"
          value={nameDraft}
          // Grid/strip names are commonly mixed case (LGridA), so only trajectory
          // electrodes get the uppercase nomenclature treatment.
          onChange={(e) => setNameDraft(isGrid ? e.target.value : e.target.value.toUpperCase())}
          onBlur={commitName}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          onClick={(e) => e.stopPropagation()}
          style={{ ...cellInputStyle, fontWeight: 700 }}
        />

        <input
          value={electrode.entryName}
          onChange={(e) => updateElectrode(electrode.id, { entryName: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          placeholder="Entry"
          style={cellInputStyle}
        />

        <input
          value={electrode.targetName}
          onChange={(e) => updateElectrode(electrode.id, { targetName: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          placeholder="Target"
          style={cellInputStyle}
        />

        <input
          type="checkbox"
          checked={checked}
          onClick={(e) => e.stopPropagation()}
          onChange={onToggleChecked}
          title="Select for bulk actions (mirror or delete)"
          style={{ width: 14, height: 14, cursor: "pointer", justifySelf: "center" }}
        />

        {isGrid ? (
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              updateElectrode(electrode.id, { contactNumbers: !electrode.contactNumbers } as Partial<Electrode>);
            }}
            title={electrode.contactNumbers ? "Contact numbers visible -- click to hide" : "Contact numbers hidden -- click to show"}
            style={{
              padding: "2px 4px",
              fontSize: 13,
              fontWeight: 700,
              color: electrode.contactNumbers ? "var(--accent)" : "var(--faint)",
              opacity: electrode.contactNumbers ? 1 : 0.5,
            }}
          >
            #
          </button>
        ) : (
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              updateElectrode(electrode.id, { showTarget: !(electrode.showTarget !== false) });
            }}
            title={electrode.showTarget !== false ? "Target marker (X) visible on canvas -- click to hide" : "Target marker (X) hidden on canvas -- click to show"}
            style={{
              padding: "2px 4px",
              fontSize: 13,
              fontWeight: 700,
              color: electrode.showTarget !== false ? "var(--accent)" : "var(--faint)",
              opacity: electrode.showTarget !== false ? 1 : 0.5,
            }}
          >
            &#10005;
          </button>
        )}

        <button
          className="btn btn-ghost btn-sm"
          onClick={(e) => {
            e.stopPropagation();
            setMoreOpen((v) => !v);
          }}
          title="Notes, color, delete"
          style={{ padding: "2px 4px", fontSize: 13, color: electrode.notes ? "var(--accent)" : "var(--muted)" }}
        >
          &#8942;
        </button>
      </div>

      {nameError && (
        <div style={{ color: "var(--danger)", fontSize: 11.5, padding: "2px 12px 4px" }}>{nameError}</div>
      )}

      {moreOpen && (
        <div
          style={{
            padding: "10px 12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            borderBottom: "1px solid var(--line)",
            background: "var(--surface-2)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {electrode.type === "grid" && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="field" style={{ width: 72 }}>
                <label>Rows</label>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={electrode.rows}
                  onChange={(e) =>
                    updateElectrode(electrode.id, {
                      rows: Math.max(1, Math.min(16, Number(e.target.value) || 1)),
                    } as Partial<Electrode>)
                  }
                />
              </div>
              <div className="field" style={{ width: 72 }}>
                <label>Columns</label>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={electrode.cols}
                  onChange={(e) =>
                    updateElectrode(electrode.id, {
                      cols: Math.max(1, Math.min(16, Number(e.target.value) || 1)),
                    } as Partial<Electrode>)
                  }
                />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 130 }}>
                <label>Rotation ({Math.round(electrode.rotation)}&#176;)</label>
                <input
                  type="range"
                  min={0}
                  max={359}
                  step={1}
                  value={((electrode.rotation % 360) + 360) % 360}
                  onChange={(e) =>
                    updateElectrode(electrode.id, { rotation: Number(e.target.value) } as Partial<Electrode>)
                  }
                />
              </div>
            </div>
          )}
          {electrode.type === "superior-inferior" && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {electrode.medialTarget
                  ? "Medial target (✕) shown on the medial view -- drag it into place."
                  : "Mark where the tip ends on the medial view."}
              </span>
              <button
                className="btn btn-sm"
                onClick={() =>
                  updateElectrode(electrode.id, {
                    medialTarget: electrode.medialTarget
                      ? undefined
                      : lateralToMedial(electrode.lateralEnd, regions),
                  } as Partial<Electrode>)
                }
                style={{ whiteSpace: "nowrap" }}
              >
                {electrode.medialTarget ? "Remove medial ✕" : "Add medial ✕"}
              </button>
            </div>
          )}
          <div className="field">
            <label>Notes</label>
            <textarea
              value={electrode.notes}
              onChange={(e) => updateElectrode(electrode.id, { notes: e.target.value })}
              rows={2}
              placeholder="Optional notes"
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
            <div className="field" style={{ maxWidth: 140 }}>
              <label>Color</label>
              <input
                type="color"
                value={electrode.color}
                onChange={(e) => updateElectrode(electrode.id, { color: e.target.value })}
                style={{ height: 32, padding: 3, cursor: "pointer" }}
              />
            </div>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => {
                if (window.confirm(`Delete electrode ${electrode.name}?`)) removeElectrode(electrode.id);
              }}
            >
              Delete Electrode
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
