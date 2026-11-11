import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import type { Electrode } from "../types";
import {
  AMP_CODES,
  LOBE_CODES,
  SMI_CODES,
  buildLateralMedialName,
  buildSuperiorInferiorName,
  isNameTaken,
} from "../lib/nomenclature";

type Tab = "name" | "anatomy" | "library" | "manual" | "grid";

/** Presets offered on the Grid/Strip tab: [label, rows, cols]. */
const ARRAY_PRESETS: ReadonlyArray<{ label: string; rows: number; cols: number; strip: boolean }> = [
  { label: "1 x 4 strip", rows: 1, cols: 4, strip: true },
  { label: "1 x 6 strip", rows: 1, cols: 6, strip: true },
  { label: "1 x 8 strip", rows: 1, cols: 8, strip: true },
  { label: "2 x 8 grid", rows: 2, cols: 8, strip: false },
  { label: "4 x 4 grid", rows: 4, cols: 4, strip: false },
  { label: "4 x 5 grid", rows: 4, cols: 5, strip: false },
  { label: "4 x 8 grid", rows: 4, cols: 8, strip: false },
  { label: "8 x 8 grid", rows: 8, cols: 8, strip: false },
];

export default function AddElectrodeDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("library");
  // Library checkbox selection lives here (not in LibraryTab) so it survives tab
  // switches, and so the dialog knows not to drop it on a stray backdrop click.
  const [librarySelection, setLibrarySelection] = useState<Set<string>>(new Set());
  const [nudge, setNudge] = useState(false);
  // Only treat a click as "outside" if the press also started on the backdrop. A
  // mousedown inside the card (e.g. selecting text in the filter box) that is released
  // over the backdrop otherwise fires a click on the backdrop and closes the dialog.
  const pressStartedOnBackdrop = useRef(false);
  const nudgeTimer = useRef<number | undefined>(undefined);

  const pending = librarySelection.size;

  const requestClose = () => {
    if (pending > 0 && !window.confirm(`Discard ${pending} selected electrode${pending === 1 ? "" : "s"}?`)) return;
    onClose();
  };

  const onBackdropClick = (e: React.MouseEvent) => {
    const fromBackdrop = pressStartedOnBackdrop.current && e.target === e.currentTarget;
    pressStartedOnBackdrop.current = false;
    if (!fromBackdrop) return;
    if (pending > 0) {
      // Never discard a selection on an outside click -- point at the way out instead.
      setNudge(true);
      window.clearTimeout(nudgeTimer.current);
      nudgeTimer.current = window.setTimeout(() => setNudge(false), 2200);
      return;
    }
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => () => window.clearTimeout(nudgeTimer.current), []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(24,36,48,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 16,
      }}
      onMouseDown={(e) => {
        pressStartedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={onBackdropClick}
    >
      <div
        className="card"
        style={{
          width: tab === "library" ? 620 : tab === "grid" ? 520 : 480,
          maxWidth: "100%",
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
          transition: "width 0.15s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
          <strong style={{ fontSize: 15 }}>Add Electrode</strong>
          {nudge && (
            <span style={{ fontSize: 12, color: "var(--danger)", marginLeft: "auto" }}>
              {pending} selected -- add them, or Close to discard
            </span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={requestClose}>
            Close
          </button>
        </div>
        <div style={{ display: "flex", gap: 4, padding: "10px 18px 0" }}>
          <TabButton active={tab === "library"} onClick={() => setTab("library")}>
            Library{pending > 0 ? ` (${pending})` : ""}
          </TabButton>
          <TabButton active={tab === "name"} onClick={() => setTab("name")}>
            By Name
          </TabButton>
          <TabButton active={tab === "manual"} onClick={() => setTab("manual")}>
            Create
          </TabButton>
          <TabButton active={tab === "grid"} onClick={() => setTab("grid")}>
            Grid/Strip
          </TabButton>
          <TabButton active={tab === "anatomy"} onClick={() => setTab("anatomy")}>
            By Target
          </TabButton>
        </div>
        <div className="scroll" style={{ padding: 18, flex: 1 }}>
          {tab === "library" && (
            <LibraryTab
              onDone={onClose}
              selectedIds={librarySelection}
              setSelectedIds={setLibrarySelection}
              highlightAdd={nudge}
            />
          )}
          {tab === "name" && <ByNameTab onDone={onClose} />}
          {tab === "manual" && <ManualTab onDone={onClose} />}
          {tab === "grid" && <GridStripTab onDone={onClose} />}
          {tab === "anatomy" && <ByAnatomyTab onDone={onClose} />}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={onClick}
      style={{
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        borderRadius: "6px 6px 0 0",
        color: active ? "var(--accent)" : "var(--muted)",
        fontWeight: active ? 600 : 500,
      }}
    >
      {children}
    </button>
  );
}

function ByNameTab({ onDone }: { onDone: () => void }) {
  const addByName = useStore((s) => s.addByName);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"lateral-medial" | "superior-inferior">("lateral-medial");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = () => {
    const res = addByName(name, mode);
    setMessage({ ok: res.ok, text: res.message });
    if (res.ok) {
      setName("");
      setTimeout(onDone, 400);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
        Enter an electrode name and choose the placement orientation. If the name matches the anatomical
        library, the curated library trajectory is always used. If there is no library match, Orthogonal is
        used by default.
      </p>
      <div className="field">
        <label>Electrode name</label>
        <input
          className="mono"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={mode === "lateral-medial" ? "LTMI" : "LAI"}
        />
      </div>
      <div className="field">
        <label>Orientation</label>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className={`btn btn-sm ${mode === "lateral-medial" ? "btn-primary" : ""}`}
            onClick={() => setMode("lateral-medial")}
            style={{ flex: 1 }}
          >
            Orthogonal
          </button>
          <button
            type="button"
            className={`btn btn-sm ${mode === "superior-inferior" ? "btn-primary" : ""}`}
            onClick={() => setMode("superior-inferior")}
            style={{ flex: 1 }}
          >
            Superior–Inferior
          </button>
        </div>
      </div>
      {message && (
        <div style={{ fontSize: 12.5, color: message.ok ? "var(--accent)" : "var(--danger)" }}>{message.text}</div>
      )}
      <button className="btn btn-primary" onClick={submit} disabled={!name.trim()}>
        Place Electrode
      </button>
    </div>
  );
}

/**
 * Suggest the next free array name for a side, e.g. LGridA / LGridB, or LSA / LSB for
 * strips. Falls back to a numeric suffix if every letter is taken.
 */
function suggestArrayName(side: "L" | "R", strip: boolean, electrodes: Electrode[]): string {
  const stem = strip ? `${side}S` : `${side}Grid`;
  for (let i = 0; i < 26; i++) {
    const candidate = `${stem}${String.fromCharCode(65 + i)}`;
    if (!isNameTaken(candidate, electrodes)) return candidate;
  }
  return `${stem}${electrodes.length + 1}`;
}

function GridStripTab({ onDone }: { onDone: () => void }) {
  const addGrid = useStore((s) => s.addGrid);
  const setSelected = useStore((s) => s.setSelected);
  const electrodes = useStore((s) => s.electrodes);

  const [side, setSide] = useState<"L" | "R">("L");
  const [rows, setRows] = useState(1);
  const [cols, setCols] = useState(8);
  const [name, setName] = useState(() => suggestArrayName("L", true, electrodes));
  const [touchedName, setTouchedName] = useState(false);

  const isStrip = rows === 1;

  // Keep the suggested name in step with side/shape until the user edits it themselves.
  const refreshName = (nextSide: "L" | "R", nextRows: number) => {
    if (touchedName) return;
    setName(suggestArrayName(nextSide, nextRows === 1, electrodes));
  };

  const applyPreset = (preset: { rows: number; cols: number }) => {
    setRows(preset.rows);
    setCols(preset.cols);
    refreshName(side, preset.rows);
  };

  const trimmed = name.trim();
  const taken = trimmed ? isNameTaken(trimmed, electrodes) : false;
  const valid = !!trimmed && !taken && rows >= 1 && cols >= 1 && rows <= 16 && cols <= 16;

  const submit = () => {
    if (!valid) return;
    const created = addGrid({ name: trimmed, rows, cols });
    setSelected(created.id);
    onDone();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
        Place a subdural grid or strip. The array is added near the top-left of the canvas and
        selected, so you can drag it into position right away. Drag a corner handle to resize it,
        the handle above the top edge to rotate it, and hold Shift while dragging to keep the
        aspect ratio (resize) or snap to 15&#176; (rotate).
      </p>

      <div className="field">
        <label>Preset</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {ARRAY_PRESETS.map((p) => {
            const active = p.rows === rows && p.cols === cols;
            return (
              <button
                key={p.label}
                type="button"
                className={`btn btn-sm ${active ? "btn-primary" : ""}`}
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div className="field" style={{ width: 90 }}>
          <label>Side</label>
          <select
            value={side}
            onChange={(e) => {
              const next = e.target.value as "L" | "R";
              setSide(next);
              refreshName(next, rows);
            }}
          >
            <option value="L">Left</option>
            <option value="R">Right</option>
          </select>
        </div>
        <div className="field" style={{ width: 90 }}>
          <label>Rows</label>
          <input
            type="number"
            min={1}
            max={16}
            value={rows}
            onChange={(e) => {
              const next = Math.max(1, Math.min(16, Number(e.target.value) || 1));
              setRows(next);
              refreshName(side, next);
            }}
          />
        </div>
        <div className="field" style={{ width: 90 }}>
          <label>Columns</label>
          <input
            type="number"
            min={1}
            max={16}
            value={cols}
            onChange={(e) => setCols(Math.max(1, Math.min(16, Number(e.target.value) || 1)))}
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 150 }}>
          <label>Name</label>
          <input
            className="mono"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setTouchedName(true);
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={isStrip ? "LSA" : "LGridA"}
          />
        </div>
      </div>

      <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
        {rows} x {cols} = <strong>{rows * cols}</strong> contacts ({isStrip ? "strip" : "grid"}).
      </div>
      {taken && <div style={{ color: "var(--danger)", fontSize: 12.5 }}>That name is already in use.</div>}

      <button className="btn btn-primary" onClick={submit} disabled={!valid}>
        Add {isStrip ? "Strip" : "Grid"}
      </button>
    </div>
  );
}

function ByAnatomyTab({ onDone }: { onDone: () => void }) {
  const anatomy = useStore((s) => s.anatomy);
  const addByAnatomy = useStore((s) => s.addByAnatomy);
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return anatomy.slice(0, 12);
    return anatomy.filter((a) => a.targetName.toLowerCase().includes(q) || a.category.toLowerCase().includes(q)).slice(0, 20);
  }, [anatomy, query]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
        Search the anatomical library. Selecting a target places both the target and its preferred entry, and
        suggests a name you can edit afterward.
      </p>
      <div className="field">
        <label>Search target</label>
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Amygdala" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
        {results.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>No matches. Add entries in Settings → Anatomical Library.</div>
        )}
        {results.map((r) => (
          <button
            key={r.id}
            className="btn"
            style={{ justifyContent: "flex-start", textAlign: "left" }}
            onClick={() => {
              addByAnatomy(r);
              onDone();
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{r.targetName}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                {r.category} · entry: {r.preferredEntry}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

type LibrarySortKey = "library" | "electrodeName" | "preferredEntry" | "targetName";

// "Library order" groups rows by hemisphere (Left, then Right, then anything
// without an L/R prefix), and within each hemisphere puts S-I electrodes
// before orthogonal ones -- otherwise preserving the order rows already have
// (anatomy-library.csv order for orthogonal rows, siRegions order for S-I rows).
function hemisphereRank(electrodeName: string): number {
  const name = electrodeName.trim().toUpperCase();
  if (name.startsWith("L")) return 0;
  if (name.startsWith("R")) return 1;
  return 2;
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        fontSize: 10.5,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: active ? "var(--accent)" : "var(--faint)",
      }}
    >
      {label}
      <span style={{ fontSize: 9, opacity: active ? 1 : 0.35 }}>{active && dir === "desc" ? "▼" : "▲"}</span>
    </button>
  );
}

type LibraryRow = {
  id: string;
  kind: "lm" | "si";
  electrodeName: string;
  preferredEntry: string;
  targetName: string;
  fileOrder: number;
};

function LibraryTab({
  onDone,
  selectedIds,
  setSelectedIds,
  highlightAdd,
}: {
  onDone: () => void;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  highlightAdd: boolean;
}) {
  const anatomy = useStore((s) => s.anatomy);
  const siRegions = useStore((s) => s.siRegions);
  const electrodes = useStore((s) => s.electrodes);
  const addByName = useStore((s) => s.addByName);
  const addByAnatomy = useStore((s) => s.addByAnatomy);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<LibrarySortKey>("library");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const anatomyById = useMemo(() => new Map(anatomy.map((a) => [a.id, a])), [anatomy]);

  const rows = useMemo<LibraryRow[]>(() => {
    const lmRows: LibraryRow[] = anatomy.map((a) => ({
      id: `lm:${a.id}`,
      kind: "lm",
      electrodeName: a.electrodeName || "",
      preferredEntry: a.preferredEntry || "",
      targetName: a.targetName,
      fileOrder: a.fileOrder,
    }));
    const siRows: LibraryRow[] = Object.entries(siRegions || {}).map(([name, anchor], idx) => ({
      id: `si:${name}`,
      kind: "si",
      electrodeName: name,
      preferredEntry: anchor.preferredEntry || "",
      targetName: anchor.targetName || "",
      fileOrder: idx,
    }));
    return [...lmRows, ...siRows];
  }, [anatomy, siRegions]);

  const isAlreadyPlaced = (row: LibraryRow) => {
    const code = row.electrodeName.trim().toUpperCase();
    // Rows with an electrode code are "added" only if an electrode with that exact
    // name is currently in the plan. Matching on target name alone is wrong: left and
    // right library entries share target names (e.g. "Amygdala"), so placing one
    // hemisphere would wrongly mark its contralateral twin as added.
    if (code) return electrodes.some((e) => e.name.trim().toUpperCase() === code);
    // Code-less rows: fall back to target + entry together (still a weak match, but
    // far less likely to collide across hemispheres than target alone).
    if (!row.targetName) return false;
    return electrodes.some(
      (e) => e.targetName === row.targetName && (e.entryName || "") === (row.preferredEntry || "")
    );
  };

  const sorted = useMemo(() => {
    const list = [...rows];
    if (sortKey === "library") {
      // Stable sort: within equal hemisphere+kind rank, rows keep the order
      // they already had (anatomy-library.csv order / siRegions order).
      list.sort((a, b) => {
        const ha = hemisphereRank(a.electrodeName);
        const hb = hemisphereRank(b.electrodeName);
        if (ha !== hb) return ha - hb;
        const ka = a.kind === "si" ? 0 : 1;
        const kb = b.kind === "si" ? 0 : 1;
        if (ka !== kb) return ka - kb;
        return a.fileOrder - b.fileOrder;
      });
      return list;
    }
    list.sort((a, b) => {
      const av = a[sortKey] || "";
      const bv = b[sortKey] || "";
      // blank electrode-name entries sink to the bottom regardless of direction
      if (sortKey === "electrodeName" && !!av !== !!bv) return av ? -1 : 1;
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [rows, sortKey, sortDir]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (r) =>
        r.targetName.toLowerCase().includes(q) ||
        r.preferredEntry.toLowerCase().includes(q) ||
        r.electrodeName.toLowerCase().includes(q)
    );
  }, [sorted, query]);

  const toggleSort = (key: LibrarySortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const placeOne = (row: LibraryRow) => {
    const code = row.electrodeName.trim().toUpperCase();
    const notTaken = code && !isNameTaken(code, useStore.getState().electrodes);
    if (row.kind === "si") {
      if (notTaken) addByName(code, "superior-inferior");
      return;
    }
    if (notTaken) {
      addByName(code);
      return;
    }
    const record = anatomyById.get(row.id.slice(3));
    if (record) addByAnatomy(record);
  };

  // The per-row Add places the electrode and keeps the dialog open, so several can be
  // added in a row; the row then shows "Added". Any other checked rows are kept.
  const addOne = (row: LibraryRow) => {
    placeOne(row);
    setSelectedIds((prev) => {
      if (!prev.has(row.id)) return prev;
      const next = new Set(prev);
      next.delete(row.id);
      return next;
    });
  };

  const addSelected = () => {
    filtered.filter((r) => selectedIds.has(r.id)).forEach(placeOne);
    onDone();
  };

  const selectedCount = selectedIds.size;
  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id));

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        filtered.forEach((r) => next.delete(r.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const gridColumns = "20px 1fr 1.3fr 1.3fr 50px";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
        Browse the anatomical library plus the superior-inferior (S–I) config -- check rows and add several
        at once, or add one directly. Entries already in your plan are marked "Added".
      </p>
      <div className="field">
        <label>Filter</label>
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by target, entry, or code" />
      </div>
      {sortKey !== "library" && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setSortKey("library")}
          style={{ alignSelf: "flex-start", fontSize: 12, padding: "2px 6px" }}
        >
          &#8634; Back to library order
        </button>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridColumns,
          gap: 6,
          alignItems: "center",
          padding: "0 8px 6px",
          borderBottom: "1px solid var(--line-strong)",
        }}
      >
        <input
          type="checkbox"
          checked={allVisibleSelected}
          onChange={toggleSelectAllVisible}
          title="Select all visible"
          style={{ cursor: "pointer" }}
        />
        <SortHeader label="Electrode" active={sortKey === "electrodeName"} dir={sortDir} onClick={() => toggleSort("electrodeName")} />
        <SortHeader label="Entry" active={sortKey === "preferredEntry"} dir={sortDir} onClick={() => toggleSort("preferredEntry")} />
        <SortHeader label="Target" active={sortKey === "targetName"} dir={sortDir} onClick={() => toggleSort("targetName")} />
        <span />
      </div>

      <div style={{ display: "flex", flexDirection: "column", maxHeight: 320, overflowY: "auto" }}>
        {filtered.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--muted)", padding: "10px 4px" }}>
            No matches. Add entries in Settings → Anatomical Library (lateral-medial) or its S–I
            click-to-build tab (superior-inferior).
          </div>
        )}
        {filtered.map((r) => {
          const added = isAlreadyPlaced(r);
          const checked = selectedIds.has(r.id);
          return (
            <div
              key={r.id}
              onClick={() => toggleRow(r.id)}
              style={{
                display: "grid",
                gridTemplateColumns: gridColumns,
                gap: 6,
                alignItems: "center",
                padding: "7px 8px",
                borderBottom: "1px solid var(--line)",
                background: checked ? "var(--accent-soft)" : "transparent",
                opacity: added ? 0.6 : 1,
                cursor: "pointer",
                fontSize: 12.5,
              }}
            >
              <input type="checkbox" checked={checked} onChange={() => toggleRow(r.id)} onClick={(e) => e.stopPropagation()} />
              <div className="mono" style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.electrodeName || "—"}</span>
                {r.kind === "si" && (
                  <span className="badge" style={{ fontSize: 8.5, padding: "1px 4px", flexShrink: 0 }} title="Superior-inferior trajectory">
                    S–I
                  </span>
                )}
              </div>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--muted)" }}>
                {r.preferredEntry || "—"}
              </div>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.targetName || "—"}</div>
              {added ? (
                <span className="badge" style={{ fontSize: 9.5, color: "var(--accent)", borderColor: "var(--accent)" }}>
                  Added
                </span>
              ) : (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    addOne(r);
                  }}
                  style={{ fontSize: 11, padding: "3px 6px" }}
                >
                  Add
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button
        className="btn btn-primary"
        onClick={addSelected}
        disabled={selectedCount === 0}
        style={highlightAdd ? { boxShadow: "0 0 0 3px var(--accent-soft), 0 0 0 5px var(--accent)" } : undefined}
      >
        Add Selected {selectedCount > 0 ? `(${selectedCount})` : ""}
      </button>
    </div>
  );
}

function ManualTab({ onDone }: { onDone: () => void }) {
  const addLateralMedial = useStore((s) => s.addLateralMedial);
  const addSuperiorInferior = useStore((s) => s.addSuperiorInferior);
  const setSelected = useStore((s) => s.setSelected);
  const electrodes = useStore((s) => s.electrodes);

  const [kind, setKind] = useState<"lateral-medial" | "superior-inferior">("lateral-medial");
  const [side, setSide] = useState<"L" | "R">("L");
  const [lobe, setLobe] = useState("T");
  const [amp, setAmp] = useState<"A" | "M" | "P">("M");
  const [smi, setSmi] = useState<"S" | "M" | "I">("M");
  const [structure, setStructure] = useState("I");
  const [ap, setAp] = useState<"A" | "P">("A");

  const generatedName =
    kind === "lateral-medial"
      ? buildLateralMedialName(side, lobe, amp, smi)
      : buildSuperiorInferiorName(side, ap, structure);

  const taken = isNameTaken(generatedName, electrodes);

  const submit = () => {
    const created =
      kind === "lateral-medial"
        ? addLateralMedial({ name: generatedName })
        : addSuperiorInferior({ name: generatedName });
    // Select it immediately so it's obviously highlighted in both the list and on the
    // canvas -- otherwise a freshly-added electrode at the default position can be easy to miss.
    setSelected(created.id);
    onDone();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
        Build a name from its parts, then place both markers manually by dragging them on the canvas.
        The electrode is added at a default position near the top-left of the canvas -- it's
        already selected (highlighted) in the list so it's easy to find. Entry/Target labels start
        blank; type them directly in the spreadsheet cells.
      </p>

      <div style={{ display: "flex", gap: 4 }}>
        <TabButton active={kind === "lateral-medial"} onClick={() => setKind("lateral-medial")}>
          Lateral–Medial
        </TabButton>
        <TabButton active={kind === "superior-inferior"} onClick={() => setKind("superior-inferior")}>
          Superior–Inferior
        </TabButton>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div className="field" style={{ width: 90 }}>
          <label>Side</label>
          <select value={side} onChange={(e) => setSide(e.target.value as "L" | "R")}>
            <option value="L">Left</option>
            <option value="R">Right</option>
          </select>
        </div>

        {kind === "lateral-medial" ? (
          <>
            <div className="field" style={{ width: 130 }}>
              <label>Lobe</label>
              <select value={lobe} onChange={(e) => setLobe(e.target.value)}>
                {Object.entries(LOBE_CODES).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label} ({code})
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ width: 130 }}>
              <label>A / M / P</label>
              <select value={amp} onChange={(e) => setAmp(e.target.value as "A" | "M" | "P")}>
                {Object.entries(AMP_CODES).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label} ({code})
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ width: 130 }}>
              <label>S / M / I</label>
              <select value={smi} onChange={(e) => setSmi(e.target.value as "S" | "M" | "I")}>
                {Object.entries(SMI_CODES).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label} ({code})
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <>
            <div className="field" style={{ width: 130 }}>
              <label>Anterior / Posterior</label>
              <select value={ap} onChange={(e) => setAp(e.target.value as "A" | "P")}>
                <option value="A">Anterior</option>
                <option value="P">Posterior</option>
              </select>
            </div>
            <div className="field" style={{ width: 130 }}>
              <label>Structure code</label>
              <input value={structure} onChange={(e) => setStructure(e.target.value.toUpperCase().slice(0, 2))} />
            </div>
          </>
        )}
      </div>

      <div className="field">
        <label>Generated name</label>
        <input className="mono" value={generatedName} readOnly style={{ fontWeight: 700, background: "var(--surface-2)" }} />
      </div>
      {taken && <div style={{ color: "var(--danger)", fontSize: 12.5 }}>That name is already in use -- adjust the parts above.</div>}

      <button className="btn btn-primary" onClick={submit} disabled={taken}>
        Add & Place Manually
      </button>
    </div>
  );
}
