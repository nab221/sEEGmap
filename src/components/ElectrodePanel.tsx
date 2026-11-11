import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useStore } from "../store/useStore";
import ElectrodeRow, { ROW_GRID_COLUMNS } from "./ElectrodeRow";
import { electrodeLetter } from "../lib/nomenclature";
import AddElectrodeDialog from "./AddElectrodeDialog";
import SketchPanel from "./SketchPanel";
import TextPanel from "./TextPanel";

export default function ElectrodePanel() {
  const electrodes = useStore((s) => s.electrodes);
  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const reorderElectrodes = useStore((s) => s.reorderElectrodes);
  const selectedId = useStore((s) => s.selectedId);
  const mirrorElectrode = useStore((s) => s.mirrorElectrode);
  const removeElectrode = useStore((s) => s.removeElectrode);
  const [showAdd, setShowAdd] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const sorted = useMemo(() => [...electrodes].sort((a, b) => a.order - b.order), [electrodes]);
  // Letters follow the full list order (as in the exported legend), so a search
  // filter never relabels the electrodes it hides.
  const letters = useMemo(() => new Map(sorted.map((e, i) => [e.id, electrodeLetter(i)])), [sorted]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.entryName.toLowerCase().includes(q) ||
        e.targetName.toLowerCase().includes(q) ||
        e.notes.toLowerCase().includes(q)
    );
  }, [sorted, searchQuery]);

  // Only count checked ids that still exist, so a stale id left over from a
  // deleted/imported electrode never shows a phantom selection count.
  const checkedCount = useMemo(
    () => electrodes.reduce((n, e) => (checkedIds.has(e.id) ? n + 1 : n), 0),
    [electrodes, checkedIds]
  );
  const allFilteredChecked = filtered.length > 0 && filtered.every((e) => checkedIds.has(e.id));

  const toggleChecked = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredChecked) filtered.forEach((e) => next.delete(e.id));
      else filtered.forEach((e) => next.add(e.id));
      return next;
    });
  };

  const handleBulkMirror = () => {
    const failures: string[] = [];
    checkedIds.forEach((id) => {
      const result = mirrorElectrode(id);
      if (!result.ok) {
        const e = electrodes.find((el) => el.id === id);
        failures.push(`${e?.name ?? id}: ${result.message}`);
      }
    });
    setCheckedIds(new Set());
    if (failures.length) window.alert(`Some electrodes could not be mirrored:\n${failures.join("\n")}`);
  };

  const handleBulkDelete = () => {
    if (checkedCount === 0) return;
    if (!window.confirm(`Delete ${checkedCount} selected electrode${checkedCount === 1 ? "" : "s"}?`)) return;
    checkedIds.forEach((id) => removeElectrode(id));
    setCheckedIds(new Set());
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = sorted.map((e) => e.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    const reordered = [...ids];
    reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, String(active.id));
    reorderElectrodes(reordered);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "14px 16px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
        <button
          className="btn btn-primary"
          onClick={() => setShowAdd(true)}
          style={{ width: "100%", padding: "12px 16px", fontSize: 15, fontWeight: 700 }}
        >
          + Add Electrode
        </button>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <strong style={{ fontSize: 14 }}>Electrodes</strong>
          <span className="badge">{electrodes.length}</span>
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name, entry, target, notes"
            style={{
              flex: 1,
              minWidth: 0,
              padding: "8px 11px",
              border: "1px solid var(--line-strong)",
              borderRadius: "var(--radius-sm)",
              fontSize: 13,
            }}
          />
          <button
            className="btn btn-sm"
            disabled={!selectedId}
            title="Mirror the selected electrode to the opposite hemisphere"
            onClick={() => {
              if (!selectedId) return;
              const result = mirrorElectrode(selectedId);
              if (!result.ok) window.alert(result.message);
            }}
          >
            Mirror R/L
          </button>
        </div>

        {checkedCount > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "7px 10px",
              background: "var(--accent-soft)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{checkedCount} selected</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-sm" title="Mirror all selected electrodes to the opposite hemisphere" onClick={handleBulkMirror}>
                Mirror R/L
              </button>
              <button className="btn btn-sm btn-danger" onClick={handleBulkDelete}>
                Delete
              </button>
              <button className="btn btn-ghost btn-sm" title="Clear selection" onClick={() => setCheckedIds(new Set())}>
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {electrodes.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: ROW_GRID_COLUMNS,
            gap: 6,
            padding: "0 8px 6px",
            margin: "0 16px",
            fontSize: 10.5,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "var(--faint)",
            borderBottom: "1px solid var(--line-strong)",
          }}
        >
          <span />
          <span title="Legend letter in exports" style={{ textAlign: "center" }}>ID</span>
          <span>Name</span>
          <span>Entry</span>
          <span>Target</span>
          <input
            type="checkbox"
            checked={allFilteredChecked}
            onChange={toggleSelectAllFiltered}
            title="Select all"
            style={{ width: 14, height: 14, cursor: "pointer", justifySelf: "center" }}
          />
          <span title="Toggle whether the target marker (X) shows on the canvas" style={{ justifySelf: "center" }}>
            X
          </span>
          <span />
        </div>
      )}

      <div className="scroll" style={{ flex: 1, minHeight: 0, padding: "0 16px 16px" }}>
        {filtered.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--muted)", padding: "20px 4px", textAlign: "center" }}>
            {electrodes.length === 0 ? "No electrodes yet. Add your first one above." : "No matches."}
          </div>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={filtered.map((e) => e.id)} strategy={verticalListSortingStrategy}>
            {filtered.map((e) => (
              <ElectrodeRow
                key={e.id}
                electrode={e}
                letter={letters.get(e.id) ?? ""}
                checked={checkedIds.has(e.id)}
                onToggleChecked={() => toggleChecked(e.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
        <SketchPanel />
        <TextPanel />
      </div>

      {showAdd && <AddElectrodeDialog onClose={() => setShowAdd(false)} />}
    </div>
  );
}
