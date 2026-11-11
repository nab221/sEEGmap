import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../store/useStore";
import type { AxialViewId, Electrode } from "../types";
import { electrodeLetter } from "../lib/nomenclature";
import { AXIAL_VIEWS, AXIAL_VIEW_ORDER } from "../lib/axialViews";
import {
  MAX_CONTACTS,
  MIN_CONTACTS,
  defaultAxialPlacement,
  formatTissueRanges,
  hemisphereOf,
  normalizeAxial,
  withContactCount,
} from "../lib/axial";

/**
 * Side list for the Axial view: per depth electrode, which outline it goes on (or Off),
 * how many contacts it has, and its marked contact ranges.
 */
export default function AxialElectrodeList() {
  const electrodes = useStore((s) => s.electrodes);
  const updateElectrode = useStore((s) => s.updateElectrode);

  const sorted = useMemo(() => [...electrodes].sort((a, b) => a.order - b.order), [electrodes]);
  // Letters follow the full plan order, grids included, so they match the Planner legend.
  const letters = useMemo(() => new Map(sorted.map((e, i) => [e.id, electrodeLetter(i)])), [sorted]);
  const depth = sorted.filter((e) => e.type !== "grid");

  const setView = (e: Electrode, value: string) => {
    if (value === "off") {
      updateElectrode(e.id, { axial: undefined });
      return;
    }
    const v = value as AxialViewId;
    if (e.axial?.view === v) return;
    updateElectrode(e.id, {
      axial: defaultAxialPlacement(AXIAL_VIEWS[v], hemisphereOf(e.name), e.axial),
    });
  };

  const setContacts = (e: Electrode, n: number) => {
    if (!e.axial) return;
    const current = normalizeAxial(e.axial);
    const next = withContactCount(current, n);
    if (next.contacts !== current.contacts) updateElectrode(e.id, { axial: next });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 14 }}>Depth electrodes</strong>
        <span className="badge">{depth.filter((e) => e.axial).length} / {depth.length} placed</span>
      </div>
      <div className="scroll" style={{ flex: 1, minHeight: 0, padding: "0 12px 16px" }}>
        {depth.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--muted)", padding: "8px 4px" }}>
            Add depth electrodes in the <Link to="/planner">Planner</Link> first.
          </p>
        ) : (
          depth.map((e) => {
            const placement = e.axial ? normalizeAxial(e.axial) : null;
            return (
              <div
                key={e.id}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  marginBottom: 6,
                  background: placement ? "var(--surface)" : "var(--surface-2)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--muted)", width: 18 }}>{letters.get(e.id)}</span>
                  <span style={{ width: 10, height: 10, borderRadius: 5, background: e.color, flexShrink: 0 }} />
                  <strong style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {e.name}
                  </strong>
                  <select
                    value={placement?.view ?? "off"}
                    onChange={(ev) => setView(e, ev.target.value)}
                    aria-label={`View for ${e.name}`}
                    style={{ fontSize: 12, padding: "3px 4px", borderRadius: 6, border: "1px solid var(--line-strong)" }}
                  >
                    <option value="off">Off</option>
                    {AXIAL_VIEW_ORDER.map((v) => (
                      <option key={v} value={v}>
                        {AXIAL_VIEWS[v].label}
                      </option>
                    ))}
                  </select>
                </div>
                {placement && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, paddingLeft: 26 }}>
                    <ContactCount
                      value={placement.contacts}
                      onCommit={(n) => setContacts(e, n)}
                      label={e.name}
                    />
                    <span style={{ fontSize: 11.5, color: "var(--muted)", flex: 1 }}>
                      {formatTissueRanges(placement.tissue)}
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/**
 * Contact count with −/+ buttons. Typed values commit on Enter or blur, so typing "15"
 * never passes through 1 and drops the marks on contacts 2–15.
 */
function ContactCount({ value, onCommit, label }: { value: number; onCommit: (n: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n)) setDraft(String(value));
    else onCommit(n);
  };

  const btn = { padding: "0 7px", height: 24, minWidth: 24 } as const;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }} title="Number of contacts (3.5 mm spacing)">
      <button className="btn btn-sm" style={btn} disabled={value <= MIN_CONTACTS} onClick={() => onCommit(value - 1)}>
        −
      </button>
      <input
        value={draft}
        inputMode="numeric"
        aria-label={`Contacts for ${label}`}
        onChange={(ev) => setDraft(ev.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
        }}
        style={{
          width: 34,
          height: 24,
          textAlign: "center",
          fontSize: 12.5,
          border: "1px solid var(--line-strong)",
          borderRadius: 6,
        }}
      />
      <button className="btn btn-sm" style={btn} disabled={value >= MAX_CONTACTS} onClick={() => onCommit(value + 1)}>
        +
      </button>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>contacts</span>
    </div>
  );
}
