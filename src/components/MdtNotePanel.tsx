import { useEffect, useRef, useState, type ReactNode } from "react";
import { v4 as uuid } from "uuid";
import { useStore } from "../store/useStore";
import {
  DEFAULT_MEETING,
  SYMBOL_GROUPS,
  SYMBOL_SHORTCUTS,
  applySymbolShortcuts as sym,
  filledSeizures,
  laterSections,
  formatMdtDate,
  parseNoteText,
  seizureTitle,
  seizureTypeLine,
  type NoteBlock,
} from "../lib/mdtNote";
import type { MdtNote, MdtSeizure } from "../types";
import {
  AsmList,
  DiagnosisFields,
  EditorSection,
  HistoryFields,
  SafetyFields,
  SocialFields,
  TreatmentFields,
} from "./MdtClinicalFields";
import { asmDose, asmName, asmStatus, asmSummary, filledAsms, historySection, type FactSection } from "../lib/clinical";
import { ILAE_GROUPS } from "../lib/ilae";

type LineFormat = "heading" | "bullet" | "numbered";

/**
 * The MDT note editor, in collapsible sections: meeting, date and who was present;
 * clinical history; seizure types (semiology and frequency); anti-seizure medication;
 * non-drug treatments; status epilepticus and safety; other diagnoses; psychiatric and
 * social history; previous investigations; and the discussion (usually pasted from the
 * MDT minutes) and outcome. A live preview of the PDF note page sits beside it.
 */
export default function MdtNotePanel({ onClose }: { onClose: () => void }) {
  const mdt = useStore((s) => s.mdt);
  const setMdt = useStore((s) => s.setMdt);
  const planNotes = useStore((s) => s.planNotes);
  const setPlanNotes = useStore((s) => s.setPlanNotes);
  const patientLabel = useStore((s) => s.patientLabel);
  const electrodes = useStore((s) => s.electrodes);
  return (
    <div
      style={{
        borderBottom: "1px solid var(--line)",
        background: "var(--surface-2)",
        maxHeight: "62vh",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px 0" }}>
        <strong style={{ fontSize: 14 }}>MDT note</strong>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          Printed as the first page of the PDF when “MDT note in PDF” is ticked; the schematic follows on the next page.
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Close
        </button>
      </div>

      {/* One scroll area for both columns, so a narrow window (columns stacked) still scrolls. */}
      <div
        className="scroll"
        style={{ display: "flex", gap: 20, padding: "12px 20px 16px", minHeight: 0, flex: 1, flexWrap: "wrap", alignItems: "flex-start" }}
      >
        {/* Editor */}
        <div style={{ flex: "1 1 420px", minWidth: 300, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "2 1 220px" }}>
              <label htmlFor="mdt-meeting">Meeting</label>
              <input
                id="mdt-meeting"
                value={mdt.meeting}
                onChange={(e) => setMdt({ meeting: e.target.value })}
                placeholder={DEFAULT_MEETING}
              />
            </div>
            <div className="field" style={{ flex: "1 1 150px" }}>
              <label htmlFor="mdt-date">Date</label>
              <input id="mdt-date" type="date" value={mdt.date} onChange={(e) => setMdt({ date: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="mdt-present">Present</label>
            <input
              id="mdt-present"
              value={mdt.attendees}
              onChange={(e) => setMdt({ attendees: e.target.value })}
              placeholder="e.g. Neurosurgery, Neurology, Neurophysiology, Neuropsychology, Neuroradiology"
            />
          </div>
          <EditorSection title="Clinical history">
            <HistoryFields value={mdt.history} onChange={(patch) => setMdt({ history: { ...mdt.history, ...patch } })} />
          </EditorSection>
          <EditorSection title="Seizure semiology and frequency" count={filledSeizures(mdt.seizures).length}>
            <SeizureList seizures={mdt.seizures} onChange={(seizures) => setMdt({ seizures })} />
          </EditorSection>
          <EditorSection title="Anti-seizure medication" count={filledAsms(mdt.asms).length}>
            <AsmList asms={mdt.asms} onChange={(asms) => setMdt({ asms })} />
          </EditorSection>
          <EditorSection title="Non-drug treatments">
            <TreatmentFields value={mdt.treatments} onChange={(patch) => setMdt({ treatments: { ...mdt.treatments, ...patch } })} />
          </EditorSection>
          <EditorSection title="Status epilepticus and safety">
            <SafetyFields value={mdt.safety} onChange={(patch) => setMdt({ safety: { ...mdt.safety, ...patch } })} />
          </EditorSection>
          <EditorSection title="Other relevant diagnoses">
            <DiagnosisFields value={mdt.diagnoses} onChange={(patch) => setMdt({ diagnoses: { ...mdt.diagnoses, ...patch } })} />
          </EditorSection>
          <EditorSection title="Psychiatric and social history">
            <SocialFields value={mdt.social} onChange={(patch) => setMdt({ social: { ...mdt.social, ...patch } })} />
          </EditorSection>
          <EditorSection title="Previous investigations">
            <FormattedField
              id="mdt-investigations"
              label="Investigations"
              value={mdt.investigations}
              onChange={(v) => setMdt({ investigations: v })}
              placeholder={"Video-EEG: …\nMRI: …\nPET: …\nNeuropsychology: …"}
              rows={6}
            />
          </EditorSection>
          <EditorSection title="Discussion and outcome">
            <FormattedField
              id="mdt-discussion"
              label="Discussion"
              value={planNotes}
              onChange={setPlanNotes}
              placeholder={"Paste the MDT discussion here.\n\nHypotheses:\n- Right mesial temporal onset…"}
              rows={10}
              hint={
                <>
                  Line breaks are kept. A short line ending in “:” or starting with “#” becomes a heading; lines starting
                  with “-” or “•” become bullets and “1.” a numbered list; “Label: text” prints the label in bold. Typed
                  shortcuts such as <Typed>-&gt;</Typed> and <Typed>&gt;=</Typed> print as → and ≥; Ω Symbols lists them all.
                </>
              }
            />
            <FormattedField
              id="mdt-outcome"
              label="Outcome / decision"
              value={mdt.outcome}
              onChange={(v) => setMdt({ outcome: v })}
              placeholder="e.g. Proceed to right-sided SEEG exploration as per the attached schematic."
              rows={3}
            />
          </EditorSection>
        </div>

        {/* Preview */}
        <div style={{ flex: "1 1 380px", minWidth: 300, display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="badge" style={{ alignSelf: "flex-start" }}>
            PDF page preview
          </span>
          <NotePreview
            patientLabel={patientLabel}
            mdt={mdt}
            discussion={planNotes}
            electrodeNotes={[...electrodes]
              .sort((a, b) => a.order - b.order)
              .filter((e) => e.notes.trim())
              .map((e) => ({ name: e.name, notes: e.notes.trim() }))}
          />
        </div>
      </div>
    </div>
  );
}

/** One card per seizure type: name, frequency and semiology, with add / reorder / remove. */
function SeizureList({ seizures, onChange }: { seizures: MdtSeizure[]; onChange: (s: MdtSeizure[]) => void }) {
  const update = (id: string, patch: Partial<MdtSeizure>) =>
    onChange(seizures.map((sz) => (sz.id === id ? { ...sz, ...patch } : sz)));
  const move = (i: number, dir: -1 | 1) => {
    const next = [...seizures];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    onChange(next);
  };
  const remove = (sz: MdtSeizure) => {
    const hasText = sz.label.trim() || sz.ilaeType || sz.description.trim() || sz.frequency.trim();
    if (hasText && !window.confirm("Remove this seizure and its description?")) return;
    onChange(seizures.filter((s) => s.id !== sz.id));
  };
  const add = () => onChange([...seizures, { id: uuid(), label: "", ilaeType: "", description: "", frequency: "" }]);

  return (
    <div className="field">
      {seizures.map((sz, i) => (
        <div
          key={sz.id}
          className="card"
          style={{ padding: "10px 12px", borderRadius: "var(--radius)", display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", whiteSpace: "nowrap", minWidth: 62 }}
            >
              Seizure {i + 1}
            </span>
            <input
              aria-label={`Seizure ${i + 1} name`}
              value={sz.label}
              onChange={(e) => update(sz.id, { label: e.target.value })}
              placeholder="Name (optional), e.g. Habitual"
              style={{ flex: 2, minWidth: 0 }}
            />
            <input
              aria-label={`Seizure ${i + 1} frequency`}
              value={sz.frequency}
              onChange={(e) => update(sz.id, { frequency: e.target.value })}
              placeholder="Frequency, e.g. 3–4 / month"
              style={{ flex: 1.4, minWidth: 0 }}
            />
            <div style={{ display: "flex", gap: 2 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title="Move up"
                aria-label={`Move seizure ${i + 1} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
                style={{ padding: "2px 6px" }}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title="Move down"
                aria-label={`Move seizure ${i + 1} down`}
                disabled={i === seizures.length - 1}
                onClick={() => move(i, 1)}
                style={{ padding: "2px 6px" }}
              >
                ↓
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-danger"
                title="Remove this seizure"
                aria-label={`Remove seizure ${i + 1}`}
                onClick={() => remove(sz)}
                style={{ padding: "2px 6px" }}
              >
                ✕
              </button>
            </div>
          </div>
          <IlaeTypeSelect
            id={`mdt-seizure-type-${sz.id}`}
            value={sz.ilaeType}
            onChange={(code) => update(sz.id, { ilaeType: code })}
          />
          <FormattedField
            id={`mdt-seizure-${sz.id}`}
            label="Semiology"
            value={sz.description}
            onChange={(v) => update(sz.id, { description: v })}
            placeholder="e.g. Epigastric rising sensation → déjà vu, then loss of awareness with oral automatisms and left hand dystonia."
            rows={3}
          />
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={add} style={{ alignSelf: "flex-start" }}>
        + Add seizure
      </button>
    </div>
  );
}

/** Drop-down of ILAE 2025 seizure types, grouped by main class. */
function IlaeTypeSelect({ id, value, onChange }: { id: string; value: string; onChange: (code: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <label
        htmlFor={id}
        title="Seizure type per the ILAE 2025 updated classification (Beniczky et al., Epilepsia 2025). Choose the main class when a detail such as consciousness couldn't be determined."
        style={{ whiteSpace: "nowrap", minWidth: 62 }}
      >
        ILAE type
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1, minWidth: 0, padding: "7px 9px", color: value ? "var(--ink)" : "var(--muted)" }}
      >
        <option value="">Not specified</option>
        {ILAE_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.types.map((t) => (
              <option key={t.code} value={t.code} style={{ color: "var(--ink)" }}>
                {t.abbr ? `${t.name} (${t.abbr})` : t.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

/** Apply (or remove) a heading / bullet / number prefix on every line the selection touches. */
function formatSelectedLines(ta: HTMLTextAreaElement, format: LineFormat, onChange: (v: string) => void) {
  const value = ta.value;
  const start = value.lastIndexOf("\n", ta.selectionStart - 1) + 1;
  const endNl = value.indexOf("\n", Math.max(ta.selectionEnd - (ta.selectionEnd > ta.selectionStart ? 1 : 0), ta.selectionStart));
  const end = endNl === -1 ? value.length : endNl;
  const lines = value.slice(start, end).split("\n");
  const patterns: Record<LineFormat, RegExp> = {
    heading: /^#{1,6}\s+/,
    bullet: /^\s*[-*•]\s+/,
    numbered: /^\s*\d{1,3}[.)]\s+/,
  };
  const strip = (l: string) => l.replace(patterns.heading, "").replace(patterns.bullet, "").replace(patterns.numbered, "");
  const allHave = lines.filter((l) => l.trim()).every((l) => patterns[format].test(l));
  let n = 0;
  const next = lines
    .map((l) => {
      if (!l.trim()) return l;
      const bare = strip(l);
      if (allHave) return bare;
      n += 1;
      return format === "heading" ? `# ${bare}` : format === "bullet" ? `- ${bare}` : `${n}. ${bare}`;
    })
    .join("\n");
  onChange(value.slice(0, start) + next + value.slice(end));
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(start, start + next.length);
  });
}

/** A labelled text box with heading / bullet / numbered-list buttons for its selected lines. */
function FormattedField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  rows: number;
  hint?: ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const format = (f: LineFormat) => ref.current && formatSelectedLines(ref.current, f, props.onChange);
  return (
    <div className="field">
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
        <label htmlFor={props.id} style={{ flex: 1 }}>
          {props.label}
        </label>
        <FormatButton title="Make the selected lines headings" onClick={() => format("heading")}>
          <b>H</b>
        </FormatButton>
        <FormatButton title="Make the selected lines a bulleted list" onClick={() => format("bullet")}>
          • List
        </FormatButton>
        <FormatButton title="Make the selected lines a numbered list" onClick={() => format("numbered")}>
          1. List
        </FormatButton>
        <SymbolPicker onPick={(symbol) => ref.current && insertAtCursor(ref.current, symbol, props.onChange)} />
      </div>
      <textarea
        id={props.id}
        ref={ref}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        rows={props.rows}
        style={{ resize: "vertical", lineHeight: 1.45, fontSize: 13 }}
      />
      {props.hint && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{props.hint}</span>}
    </div>
  );
}

/** A typed shortcut shown literally: the UI font would otherwise draw "->" as an arrow. */
function Typed({ children }: { children: ReactNode }) {
  return <code style={{ fontFamily: "var(--font-mono)", fontVariantLigatures: "none", color: "var(--ink)" }}>{children}</code>;
}

/** Put `text` in place of the textarea's selection and leave the cursor after it. */
function insertAtCursor(ta: HTMLTextAreaElement, text: string, onChange: (v: string) => void) {
  const { selectionStart: start, selectionEnd: end, value } = ta;
  onChange(value.slice(0, start) + text + value.slice(end));
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(start + text.length, start + text.length);
  });
}

/** "Ω" button opening a palette of symbols that print in the PDF, and the typing shortcuts. */
const PICKER_W = 328;
const PICKER_H = 330;

function SymbolPicker({ onPick }: { onPick: (symbol: string) => void }) {
  // Where the palette sits, in viewport coordinates: it is fixed-positioned so the note
  // panel's scroll area can't clip it. null = closed.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  const toggle = () => {
    if (open || !boxRef.current) return setPos(null);
    const r = boxRef.current.getBoundingClientRect();
    const below = r.bottom + 6 + PICKER_H <= window.innerHeight;
    setPos({
      left: Math.max(8, Math.min(r.right - PICKER_W, window.innerWidth - PICKER_W - 8)),
      top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - PICKER_H),
    });
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    // Scrolling would leave the fixed palette behind its button: close it instead.
    const onScroll = (e: Event) => {
      if (!boxRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div ref={boxRef}>
      <FormatButton title="Insert a symbol" onClick={toggle}>
        Ω Symbols
      </FormatButton>
      {pos && (
        <div
          role="dialog"
          aria-label="Insert a symbol"
          className="card"
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            zIndex: 50,
            width: PICKER_W,
            padding: 12,
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-md)",
            textTransform: "none",
            letterSpacing: "normal",
          }}
        >
          {SYMBOL_GROUPS.map((group) => (
            <div key={group.label} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>{group.label}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {group.symbols.map((symbol) => (
                  <button
                    key={symbol}
                    type="button"
                    className="btn btn-sm"
                    title={`Insert ${symbol}`}
                    onMouseDown={(e) => e.preventDefault()} // keep the textarea's cursor
                    onClick={() => onPick(symbol)}
                    style={{ width: 30, height: 30, padding: 0, fontSize: 15 }}
                  >
                    {symbol}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8, fontSize: 11.5, color: "var(--muted)" }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Or type</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, auto)", gap: "2px 10px", justifyContent: "start" }}>
              {SYMBOL_SHORTCUTS.map(([typed, symbol]) => (
                <span key={typed} style={{ whiteSpace: "nowrap" }}>
                  <Typed>{typed}</Typed>{" "}
                  {symbol}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormatButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="btn btn-sm"
      title={title}
      onMouseDown={(e) => e.preventDefault()} // keep the textarea's selection
      onClick={onClick}
      style={{ padding: "3px 8px", fontSize: 12 }}
    >
      {children}
    </button>
  );
}

const ACCENT = "#1f5f8b";

/** On-screen approximation of the PDF note page (same blocks, same order). */
function NotePreview(props: {
  patientLabel: string;
  mdt: MdtNote;
  discussion: string;
  electrodeNotes: { name: string; notes: string }[];
}) {
  const { mdt } = props;
  const seizures = filledSeizures(mdt.seizures);
  const history = historySection(mdt.history);
  const asms = filledAsms(mdt.asms);
  const later = laterSections(mdt);
  const investigations = parseNoteText(mdt.investigations);
  const discussion = parseNoteText(props.discussion);
  const outcome = parseNoteText(mdt.outcome);
  const date = formatMdtDate(mdt.date);
  const empty =
    history.facts.length === 0 &&
    seizures.length === 0 &&
    asms.length === 0 &&
    later.length === 0 &&
    investigations.length === 0 &&
    discussion.length === 0 &&
    outcome.length === 0 &&
    props.electrodeNotes.length === 0;
  return (
    <div
      style={{
        background: "#fff",
        color: "#182430",
        border: "1px solid var(--line)",
        borderRadius: 4,
        boxShadow: "var(--shadow-md)",
        padding: "22px 28px 28px",
        fontFamily: "Helvetica, Arial, sans-serif",
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      {props.patientLabel.trim() && (
        <div style={{ textAlign: "right", fontWeight: 700, fontSize: 11, marginBottom: 6 }}>{props.patientLabel.trim()}</div>
      )}
      <div style={{ fontWeight: 700, fontSize: 18, lineHeight: 1.25 }}>{sym(mdt.meeting.trim() || DEFAULT_MEETING)}</div>
      {date && <div style={{ color: "#606c78", fontSize: 13 }}>{date}</div>}
      <div style={{ height: 2, background: ACCENT, margin: "8px 0 10px" }} />
      {mdt.attendees.trim() && (
        <p style={{ margin: "0 0 10px" }}>
          <b>Present: </b>
          {sym(mdt.attendees.trim().replace(/\s*\n\s*/g, ", "))}
        </p>
      )}
      <FactsPreview section={history} />
      {seizures.length > 0 && (
        <>
          <SectionHeading>Seizure semiology and frequency</SectionHeading>
          {seizures.map((sz, i) => (
            <div key={sz.id} style={{ marginTop: i ? 8 : 0 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                <b style={{ flex: 1, fontSize: 12.5 }}>{sym(seizureTitle(sz, i))}</b>
                {sz.frequency.trim() && (
                  <b style={{ color: ACCENT, fontSize: 12, textAlign: "right" }}>Frequency: {sym(sz.frequency.trim())}</b>
                )}
              </div>
              {seizureTypeLine(sz) && (
                <div style={{ color: "#606c78", fontSize: 11.5, paddingLeft: 14 }}>ILAE: {seizureTypeLine(sz)}</div>
              )}
              <div style={{ paddingLeft: 14 }}>
                <Blocks blocks={parseNoteText(sz.description)} />
              </div>
            </div>
          ))}
          <div style={{ height: 6 }} />
        </>
      )}
      {asms.length > 0 && (
        <>
          <SectionHeading>Anti-seizure medication</SectionHeading>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
            <tbody>
              {asms.map((a) => (
                <tr key={a.id} style={{ borderBottom: "1px solid #d0d8e0" }}>
                  <td style={{ fontWeight: 700, padding: "2px 8px 2px 0", whiteSpace: "nowrap" }}>{sym(asmName(a))}</td>
                  <td style={{ padding: "2px 8px", whiteSpace: "nowrap" }}>{asmDose(a)}</td>
                  <td style={{ padding: "2px 0 2px 8px" }}>{sym(asmStatus(a))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {asmSummary(mdt.asms).map((line, i) => (
            <div key={line} style={{ marginTop: i ? 0 : 4, fontWeight: i ? 700 : 400, color: i ? ACCENT : "#606c78" }}>
              {line}
            </div>
          ))}
          <div style={{ height: 6 }} />
        </>
      )}
      {later.map((section) => (
        <FactsPreview key={section.heading} section={section} />
      ))}
      {investigations.length > 0 && (
        <>
          <SectionHeading>Previous investigations</SectionHeading>
          <Blocks blocks={investigations} />
        </>
      )}
      {discussion.length > 0 && (
        <>
          <SectionHeading>Discussion</SectionHeading>
          <Blocks blocks={discussion} />
        </>
      )}
      {outcome.length > 0 && (
        <div style={{ background: "#ecf3f9", borderLeft: `4px solid ${ACCENT}`, padding: "8px 12px", margin: "14px 0" }}>
          <div style={{ color: ACCENT, fontWeight: 700, fontSize: 10.5, letterSpacing: "0.06em", marginBottom: 2 }}>
            OUTCOME / DECISION
          </div>
          <Blocks blocks={outcome} />
        </div>
      )}
      {props.electrodeNotes.length > 0 && (
        <>
          <SectionHeading>Electrode notes</SectionHeading>
          {props.electrodeNotes.map((e, i) => (
            <div
              key={i}
              style={{ display: "flex", gap: 10, padding: "3px 0", borderTop: i ? "1px solid #d0d8e0" : undefined }}
            >
              <b style={{ width: 80, flexShrink: 0 }}>{e.name}</b>
              <span style={{ whiteSpace: "pre-wrap" }}>{sym(e.notes)}</span>
            </div>
          ))}
        </>
      )}
      {empty && (
        <p style={{ color: "#97a2b3", fontStyle: "italic", margin: "8px 0 0" }}>
          The history, seizures, medication, investigations, discussion and outcome will appear here.
        </p>
      )}
    </div>
  );
}

/** A section of "Label: value" lines, as on the PDF. Nothing when the section is empty. */
function FactsPreview({ section }: { section: FactSection }) {
  if (!section.facts.length) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <SectionHeading>{section.heading}</SectionHeading>
      {section.facts.map((f, i) => (
        <div key={i} style={{ whiteSpace: "pre-wrap" }}>
          {f.label && <b>{f.label}: </b>}
          {sym(f.value)}
        </div>
      ))}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: ACCENT,
        fontWeight: 700,
        fontSize: 10.5,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        borderBottom: "1px solid #d0d8e0",
        paddingBottom: 2,
        margin: "8px 0 6px",
      }}
    >
      {children}
    </div>
  );
}

function Blocks({ blocks }: { blocks: NoteBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "gap":
            return <div key={i} style={{ height: 8 }} />;
          case "heading":
            return (
              <div key={i} style={{ fontWeight: 700, fontSize: 12.5, marginTop: i && blocks[i - 1].kind !== "gap" ? 6 : 0 }}>
                {b.text}
              </div>
            );
          case "bullet":
          case "numbered":
            return (
              <div key={i} style={{ display: "flex", paddingLeft: 12 + b.level * 18 }}>
                <span
                  style={{
                    minWidth: 16,
                    paddingRight: 4,
                    color: b.kind === "bullet" ? ACCENT : undefined,
                  }}
                >
                  {b.kind === "bullet" ? (b.level ? "–" : "•") : b.marker}
                </span>
                <span>{b.text}</span>
              </div>
            );
          case "para":
            return (
              <div key={i}>
                {b.label && <b>{b.label}: </b>}
                {b.text}
              </div>
            );
        }
      })}
    </>
  );
}
