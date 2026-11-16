import { useRef, type ReactNode } from "react";
import { useStore } from "../store/useStore";
import { DEFAULT_MEETING, formatMdtDate, parseNoteText, type NoteBlock } from "../lib/mdtNote";

type LineFormat = "heading" | "bullet" | "numbered";

/**
 * The MDT note editor: meeting, date, who was present, previous investigations, the
 * discussion (usually pasted from the MDT minutes) and the outcome, with a live preview
 * of the PDF note page.
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
          <FormattedField
            id="mdt-investigations"
            label="Previous investigations"
            value={mdt.investigations}
            onChange={(v) => setMdt({ investigations: v })}
            placeholder={"Video-EEG: …\nMRI: …\nPET: …\nNeuropsychology: …"}
            rows={6}
          />
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
                with “-” or “•” become bullets and “1.” a numbered list; “Label: text” prints the label in bold.
              </>
            }
          />
          <div className="field">
            <label htmlFor="mdt-outcome">Outcome / decision</label>
            <textarea
              id="mdt-outcome"
              value={mdt.outcome}
              onChange={(e) => setMdt({ outcome: e.target.value })}
              placeholder="e.g. Proceed to right-sided SEEG exploration as per the attached schematic."
              rows={3}
              style={{ resize: "vertical", lineHeight: 1.45, fontSize: 13 }}
            />
          </div>
        </div>

        {/* Preview */}
        <div style={{ flex: "1 1 380px", minWidth: 300, display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="badge" style={{ alignSelf: "flex-start" }}>
            PDF page preview
          </span>
          <NotePreview
            patientLabel={patientLabel}
            meeting={mdt.meeting}
            date={mdt.date}
            attendees={mdt.attendees}
            investigations={mdt.investigations}
            discussion={planNotes}
            outcome={mdt.outcome}
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
  meeting: string;
  date: string;
  attendees: string;
  investigations: string;
  discussion: string;
  outcome: string;
  electrodeNotes: { name: string; notes: string }[];
}) {
  const investigations = parseNoteText(props.investigations);
  const discussion = parseNoteText(props.discussion);
  const outcome = parseNoteText(props.outcome);
  const date = formatMdtDate(props.date);
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
      <div style={{ fontWeight: 700, fontSize: 18, lineHeight: 1.25 }}>{props.meeting.trim() || DEFAULT_MEETING}</div>
      {date && <div style={{ color: "#606c78", fontSize: 13 }}>{date}</div>}
      <div style={{ height: 2, background: ACCENT, margin: "8px 0 10px" }} />
      {props.attendees.trim() && (
        <p style={{ margin: "0 0 10px" }}>
          <b>Present: </b>
          {props.attendees.trim().replace(/\s*\n\s*/g, ", ")}
        </p>
      )}
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
              <span style={{ whiteSpace: "pre-wrap" }}>{e.notes}</span>
            </div>
          ))}
        </>
      )}
      {investigations.length === 0 && discussion.length === 0 && outcome.length === 0 && props.electrodeNotes.length === 0 && (
        <p style={{ color: "#97a2b3", fontStyle: "italic", margin: "8px 0 0" }}>
          The investigations, discussion and outcome will appear here.
        </p>
      )}
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
