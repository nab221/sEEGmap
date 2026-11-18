import type { ReactNode } from "react";
import { v4 as uuid } from "uuid";
import {
  ASM_LIST,
  DIAGNOSES,
  HANDEDNESS,
  OTHER_ASM,
  RISK_FACTORS,
  STOP_REASONS,
  SUDEP_RISKS,
  TREATMENTS,
  asmSummary,
  epilepsyDuration,
  newAsm,
  type ListOption,
} from "../lib/clinical";
import type { MdtAsm, MdtChecklist, MdtHistory, MdtSafety, MdtSocial } from "../types";

/** A collapsible group of fields in the MDT note editor. Starts open. */
export function EditorSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <details open className="mdt-section" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      <summary
        style={{
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 700,
          color: "var(--ink)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          listStyle: "revert",
        }}
      >
        {title}
        {!!count && <span className="badge">{count}</span>}
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </details>
  );
}

/** Tick-box chips for a fixed list. */
export function Chips({
  label,
  list,
  value,
  onChange,
}: {
  label: string;
  list: ListOption[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (code: string) =>
    onChange(value.includes(code) ? value.filter((c) => c !== code) : list.filter((o) => o.code === code || value.includes(o.code)).map((o) => o.code));
  return (
    <div className="field">
      <label>{label}</label>
      <div role="group" aria-label={label} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {list.map((o) => {
          const on = value.includes(o.code);
          return (
            <button
              key={o.code}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(o.code)}
              className="btn btn-sm"
              style={{
                padding: "4px 10px",
                fontSize: 12.5,
                borderRadius: 999,
                background: on ? "var(--accent-soft)" : "var(--surface)",
                borderColor: on ? "var(--accent)" : "var(--line-strong)",
                color: on ? "var(--accent)" : "var(--ink)",
                fontWeight: on ? 600 : 400,
              }}
            >
              {on ? "✓ " : ""}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TextBox({
  id,
  label,
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        style={{ resize: "vertical", lineHeight: 1.45, fontSize: 13 }}
      />
    </div>
  );
}

export function HistoryFields({ value, onChange }: { value: MdtHistory; onChange: (patch: Partial<MdtHistory>) => void }) {
  const duration = epilepsyDuration(value);
  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ flex: "1 1 110px" }}>
          <label htmlFor="mdt-age">Age at MDT (years)</label>
          <input id="mdt-age" inputMode="decimal" value={value.ageAtMdt} onChange={(e) => onChange({ ageAtMdt: e.target.value })} />
        </div>
        <div className="field" style={{ flex: "1 1 110px" }}>
          <label htmlFor="mdt-onset">Age at onset (years)</label>
          <input
            id="mdt-onset"
            inputMode="decimal"
            value={value.ageAtOnset}
            onChange={(e) => onChange({ ageAtOnset: e.target.value })}
          />
        </div>
        <div className="field" style={{ flex: "1 1 130px" }}>
          <label htmlFor="mdt-hand">Handedness</label>
          <select
            id="mdt-hand"
            value={value.handedness}
            onChange={(e) => onChange({ handedness: e.target.value as MdtHistory["handedness"] })}
          >
            <option value="">Not recorded</option>
            {HANDEDNESS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {duration !== null && (
        <span style={{ fontSize: 12, color: "var(--muted)", marginTop: -6 }}>
          Epilepsy duration: {duration} {duration === 1 ? "year" : "years"}
        </span>
      )}
      <Chips label="Early risk factors" list={RISK_FACTORS} value={value.riskFactors} onChange={(riskFactors) => onChange({ riskFactors })} />
      <TextBox
        id="mdt-history-notes"
        label="History notes"
        value={value.notes}
        onChange={(notes) => onChange({ notes })}
        placeholder="e.g. Complex febrile seizure aged 2; habitual seizures from age 14."
      />
    </>
  );
}

const smallInput = { padding: "6px 8px", fontSize: 13, minWidth: 0 } as const;

/** One row per ASM: drug from the list, total daily dose, current / previous and why stopped. */
export function AsmList({ asms, onChange }: { asms: MdtAsm[]; onChange: (a: MdtAsm[]) => void }) {
  const update = (id: string, patch: Partial<MdtAsm>) => onChange(asms.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const remove = (id: string) => onChange(asms.filter((a) => a.id !== id));
  const add = (status: MdtAsm["status"]) => onChange([...asms, { ...newAsm(uuid()), status }]);
  const summary = asmSummary(asms);

  return (
    <div className="field">
      {asms.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {asms.map((a, i) => (
            <div
              key={a.id}
              className="card"
              style={{ padding: "8px 10px", borderRadius: "var(--radius)", display: "flex", flexDirection: "column", gap: 6 }}
            >
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select
                  aria-label={`ASM ${i + 1} drug`}
                  value={a.drug}
                  onChange={(e) => update(a.id, { drug: e.target.value })}
                  style={{ ...smallInput, flex: 2, color: a.drug ? "var(--ink)" : "var(--muted)" }}
                >
                  <option value="">Choose ASM…</option>
                  {ASM_LIST.map((o) => (
                    <option key={o.code} value={o.code} style={{ color: "var(--ink)" }}>
                      {o.label}
                    </option>
                  ))}
                  <option value={OTHER_ASM} style={{ color: "var(--ink)" }}>
                    Other…
                  </option>
                </select>
                {a.drug === OTHER_ASM && (
                  <input
                    aria-label={`ASM ${i + 1} name`}
                    value={a.otherName}
                    onChange={(e) => update(a.id, { otherName: e.target.value })}
                    placeholder="Drug name"
                    style={{ ...smallInput, flex: 1.5 }}
                  />
                )}
                <input
                  aria-label={`ASM ${i + 1} total daily dose`}
                  inputMode="decimal"
                  value={a.dose}
                  onChange={(e) => update(a.id, { dose: e.target.value })}
                  placeholder="Dose"
                  style={{ ...smallInput, width: 70, flex: "0 0 70px" }}
                />
                <select
                  aria-label={`ASM ${i + 1} dose unit`}
                  value={a.unit}
                  onChange={(e) => update(a.id, { unit: e.target.value as MdtAsm["unit"] })}
                  style={{ ...smallInput, flex: "0 0 auto" }}
                >
                  <option value="mg/day">mg/day</option>
                  <option value="mg/kg/day">mg/kg/day</option>
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-danger"
                  aria-label={`Remove ASM ${i + 1}`}
                  title="Remove this ASM"
                  onClick={() => remove(a.id)}
                  style={{ padding: "2px 6px" }}
                >
                  ✕
                </button>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select
                  aria-label={`ASM ${i + 1} status`}
                  value={a.status}
                  onChange={(e) => update(a.id, { status: e.target.value as MdtAsm["status"] })}
                  style={{ ...smallInput, flex: "0 0 auto" }}
                >
                  <option value="current">Current</option>
                  <option value="previous">Previous</option>
                </select>
                {a.status === "previous" && (
                  <select
                    aria-label={`ASM ${i + 1} reason stopped`}
                    value={a.reasonStopped}
                    onChange={(e) => update(a.id, { reasonStopped: e.target.value as MdtAsm["reasonStopped"] })}
                    style={{ ...smallInput, flex: 1.4, color: a.reasonStopped ? "var(--ink)" : "var(--muted)" }}
                  >
                    <option value="">Reason stopped: not known</option>
                    {STOP_REASONS.map((o) => (
                      <option key={o.code} value={o.code} style={{ color: "var(--ink)" }}>
                        Stopped: {o.label.toLowerCase()}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  aria-label={`ASM ${i + 1} note`}
                  value={a.note}
                  onChange={(e) => update(a.id, { note: e.target.value })}
                  placeholder={a.status === "previous" ? "Note, e.g. max 3000 mg, rash" : "Note, e.g. since 2021"}
                  style={{ ...smallInput, flex: 1 }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" className="btn btn-sm" onClick={() => add("current")}>
          + Current ASM
        </button>
        <button type="button" className="btn btn-sm" onClick={() => add("previous")}>
          + Previous ASM
        </button>
      </div>
      {summary.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {summary.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChecklistFields({
  idPrefix,
  label,
  list,
  value,
  onChange,
  notesPlaceholder,
}: {
  idPrefix: string;
  label: string;
  list: ListOption[];
  value: MdtChecklist;
  onChange: (patch: Partial<MdtChecklist>) => void;
  notesPlaceholder: string;
}) {
  return (
    <>
      <Chips label={label} list={list} value={value.options} onChange={(options) => onChange({ options })} />
      <TextBox
        id={`${idPrefix}-notes`}
        label="Notes"
        value={value.notes}
        onChange={(notes) => onChange({ notes })}
        placeholder={notesPlaceholder}
      />
    </>
  );
}

export const TreatmentFields = (p: { value: MdtChecklist; onChange: (patch: Partial<MdtChecklist>) => void }) => (
  <ChecklistFields
    idPrefix="mdt-treatments"
    label="Tried or in place"
    list={TREATMENTS}
    notesPlaceholder="e.g. VNS implanted 2019, settings…; previous left temporal lesionectomy 2015"
    {...p}
  />
);

export const DiagnosisFields = (p: { value: MdtChecklist; onChange: (patch: Partial<MdtChecklist>) => void }) => (
  <ChecklistFields
    idPrefix="mdt-diagnoses"
    label="Diagnoses"
    list={DIAGNOSES}
    notesPlaceholder="Any other relevant diagnoses"
    {...p}
  />
);

export function SafetyFields({ value, onChange }: { value: MdtSafety; onChange: (patch: Partial<MdtSafety>) => void }) {
  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ flex: "0 1 170px" }}>
          <label htmlFor="mdt-se">Status epilepticus</label>
          <select
            id="mdt-se"
            value={value.statusEpilepticus}
            onChange={(e) => onChange({ statusEpilepticus: e.target.value as MdtSafety["statusEpilepticus"] })}
          >
            <option value="">Not recorded</option>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </div>
        <div className="field" style={{ flex: "1 1 220px" }}>
          <label htmlFor="mdt-se-details">Details</label>
          <input
            id="mdt-se-details"
            value={value.statusDetails}
            onChange={(e) => onChange({ statusDetails: e.target.value })}
            placeholder="e.g. Convulsive SE 2022, ICU admission"
          />
        </div>
      </div>
      <TextBox
        id="mdt-injuries"
        label="Seizure-related injuries"
        value={value.injuries}
        onChange={(injuries) => onChange({ injuries })}
        placeholder="e.g. Burns, fractures, head injuries"
      />
      <Chips label="SUDEP risk factors" list={SUDEP_RISKS} value={value.sudepRisks} onChange={(sudepRisks) => onChange({ sudepRisks })} />
      <TextBox id="mdt-safety-notes" label="Notes" value={value.notes} onChange={(notes) => onChange({ notes })} />
    </>
  );
}

export function SocialFields({ value, onChange }: { value: MdtSocial; onChange: (patch: Partial<MdtSocial>) => void }) {
  return (
    <>
      <TextBox
        id="mdt-psych"
        label="Psychiatric history"
        value={value.psychiatric}
        onChange={(psychiatric) => onChange({ psychiatric })}
        placeholder="e.g. Depression, on sertraline; no psychosis; neuropsychiatry review…"
      />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px" }}>
          <TextBox id="mdt-driving" label="Driving" value={value.driving} onChange={(driving) => onChange({ driving })} rows={1} />
        </div>
        <div style={{ flex: "1 1 200px" }}>
          <TextBox
            id="mdt-employment"
            label="Employment / education"
            value={value.employment}
            onChange={(employment) => onChange({ employment })}
            rows={1}
          />
        </div>
      </div>
      <TextBox
        id="mdt-goals"
        label="Patient's goals"
        value={value.goals}
        onChange={(goals) => onChange({ goals })}
        placeholder="e.g. Seizure freedom to return to driving; understands risks of SEEG"
      />
    </>
  );
}
