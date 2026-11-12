import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../store/useStore";
import type { AxialPlacement, AxialViewId, Electrode } from "../types";
import { electrodeLetter } from "../lib/nomenclature";
import { AXIAL_VIEWS, viewPickerOrder } from "../lib/axialViews";
import {
  MAX_CONTACTS,
  MIN_CONTACTS,
  defaultAxialPlacement,
  effectiveTissue,
  formatTissueRanges,
  hemisphereOf,
  isOffScale,
  normalizeAxial,
  setLastInBrain,
  shaftFit,
  withContactCount,
} from "../lib/axial";
import { useBrainMask } from "../lib/useBrainMask";

/**
 * Side list for the Electrode view: per depth electrode, which outline it goes on (or
 * Off), how many contacts it has, the last contact in brain, how the shaft fits the
 * outline, and its marked contact ranges.
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
    const current = normalizeAxial(e.axial);
    if (current?.view === v) return;
    updateElectrode(e.id, {
      axial: defaultAxialPlacement(AXIAL_VIEWS[v], hemisphereOf(e.name), current ?? undefined),
    });
  };

  const setContacts = (e: Electrode, n: number) => {
    const current = normalizeAxial(e.axial);
    if (!current) return;
    const next = withContactCount(current, n);
    if (next.contacts !== current.contacts) updateElectrode(e.id, { axial: next });
  };

  const setPlacement = (e: Electrode, next: AxialPlacement) => updateElectrode(e.id, { axial: next });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 14 }}>Depth electrodes</strong>
        <span className="badge">{depth.filter((e) => normalizeAxial(e.axial)).length} / {depth.length} placed</span>
      </div>
      <div className="scroll" style={{ flex: 1, minHeight: 0, padding: "0 12px 16px" }}>
        {depth.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--muted)", padding: "8px 4px" }}>
            Add depth electrodes in the <Link to="/planner">Planner</Link> first.
          </p>
        ) : (
          depth.map((e) => {
            const placement = normalizeAxial(e.axial);
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
                    {viewPickerOrder(hemisphereOf(e.name)).map((v) => (
                      <option key={v} value={v}>
                        {AXIAL_VIEWS[v].label}
                      </option>
                    ))}
                  </select>
                </div>
                {placement && (
                  <PlacementDetails
                    electrode={e}
                    placement={placement}
                    onContacts={(n) => setContacts(e, n)}
                    onChange={(next) => setPlacement(e, next)}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Count, "last in brain", fit and ranges for one placed electrode. */
function PlacementDetails({
  electrode,
  placement,
  onContacts,
  onChange,
}: {
  electrode: Electrode;
  placement: AxialPlacement;
  onContacts: (n: number) => void;
  onChange: (next: AxialPlacement) => void;
}) {
  const mask = useBrainMask(placement.view);
  const fit = shaftFit(placement, AXIAL_VIEWS[placement.view], mask);
  const pct = Math.round(fit.ratio * 100);
  const warn = isOffScale(fit) || fit.status === "no-crossing";
  const small = { fontSize: 11.5, color: "var(--muted)" } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6, paddingLeft: 26 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <ContactCount value={placement.contacts} onCommit={onContacts} label={electrode.name} />
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--muted)" }}>
          Last in brain
          <select
            value={placement.lastInBrain ?? ""}
            onChange={(ev) =>
              onChange(setLastInBrain(placement, ev.target.value === "" ? undefined : Number(ev.target.value)))
            }
            aria-label={`Last contact in brain for ${electrode.name}`}
            style={{ fontSize: 12, padding: "2px 4px", borderRadius: 6, border: "1px solid var(--line-strong)" }}
          >
            <option value="">All</option>
            {Array.from({ length: placement.contacts }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(fit.status !== "nominal" || placement.edgeDist !== undefined) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, ...small, color: warn ? "#b45309" : small.color }}>
          <span style={{ flex: 1 }}>
            {fit.status === "no-crossing"
              ? "⚠ Brain edge not found; standard spacing"
              : isOffScale(fit)
                ? `⚠ ${pct}% of true scale. Try another view or check the tip`
                : `Scale ${pct}%`}
          </span>
          {placement.edgeDist !== undefined && (
            <button
              className="btn btn-sm"
              style={{ height: 22, padding: "0 7px", fontSize: 11 }}
              onClick={() => {
                const { edgeDist: _drop, ...rest } = placement;
                onChange(rest);
              }}
              title="Go back to the edge found from the outline"
            >
              Reset edge
            </button>
          )}
        </div>
      )}
      <span style={small}>{formatTissueRanges(effectiveTissue(placement))}</span>
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
