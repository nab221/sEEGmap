// Phase 1 clinical details for the MDT note: history, anti-seizure medication (ASMs),
// non-drug treatments, status epilepticus and safety, other diagnoses, and psychiatric and
// social history. Fixed lists keep entries consistent for audit; each list has free-text
// notes beside it for anything else. The note's PDF, preview and PowerPoint text are all
// built from the summaries here, so they always say the same thing.

import type { MdtAsm, MdtChecklist, MdtHistory, MdtSafety, MdtSocial } from "../types";

export interface ListOption {
  code: string;
  label: string;
}

/** Anti-seizure medications (UK names), alphabetical. "other" lets a name be typed. */
export const ASM_LIST: ListOption[] = [
  "Acetazolamide",
  "Brivaracetam",
  "Cannabidiol",
  "Carbamazepine",
  "Cenobamate",
  "Clobazam",
  "Clonazepam",
  "Eslicarbazepine acetate",
  "Ethosuximide",
  "Everolimus",
  "Fenfluramine",
  "Gabapentin",
  "Lacosamide",
  "Lamotrigine",
  "Levetiracetam",
  "Oxcarbazepine",
  "Perampanel",
  "Phenobarbital",
  "Phenytoin",
  "Pregabalin",
  "Primidone",
  "Rufinamide",
  "Sodium valproate",
  "Stiripentol",
  "Sulthiame",
  "Tiagabine",
  "Topiramate",
  "Vigabatrin",
  "Zonisamide",
].map((label) => ({ code: label.toLowerCase().replace(/[^a-z]+/g, "-"), label }));
export const OTHER_ASM = "other";

export const RISK_FACTORS: ListOption[] = [
  { code: "febrile-simple", label: "Febrile seizures (simple)" },
  { code: "febrile-complex", label: "Febrile seizures (complex / prolonged)" },
  { code: "perinatal", label: "Perinatal insult (e.g. HIE, prematurity)" },
  { code: "cns-infection", label: "CNS infection (meningitis / encephalitis)" },
  { code: "head-injury", label: "Significant head injury" },
  { code: "stroke", label: "Stroke / vascular event" },
  { code: "family-history", label: "Family history of epilepsy" },
  { code: "developmental", label: "Developmental delay" },
];

export const TREATMENTS: ListOption[] = [
  { code: "vns", label: "VNS" },
  { code: "dbs", label: "DBS" },
  { code: "rns", label: "RNS" },
  { code: "diet", label: "Ketogenic / modified Atkins diet" },
  { code: "surgery", label: "Previous epilepsy surgery" },
];

export const SUDEP_RISKS: ListOption[] = [
  { code: "tc-last-year", label: "Tonic-clonic seizures in the last year" },
  { code: "tc-3-per-year", label: "≥3 tonic-clonic seizures a year" },
  { code: "nocturnal", label: "Nocturnal seizures" },
  { code: "alone-at-night", label: "Sleeps alone / unsupervised at night" },
];

export const DIAGNOSES: ListOption[] = [
  { code: "intellectual-disability", label: "Intellectual disability" },
  { code: "autism", label: "Autism spectrum disorder" },
  { code: "adhd", label: "ADHD" },
  { code: "depression", label: "Depression" },
  { code: "anxiety", label: "Anxiety" },
  { code: "psychosis", label: "Psychosis" },
  { code: "functional-seizures", label: "Functional / dissociative seizures" },
  { code: "migraine", label: "Migraine" },
  { code: "sleep", label: "Sleep disorder (e.g. OSA)" },
  { code: "cardiac", label: "Cardiac disease / arrhythmia" },
];

export const HANDEDNESS: ListOption[] = [
  { code: "right", label: "Right" },
  { code: "left", label: "Left" },
  { code: "ambidextrous", label: "Ambidextrous" },
];

export const STOP_REASONS: ListOption[] = [
  { code: "inefficacy", label: "Lack of efficacy" },
  { code: "adverse", label: "Adverse effects" },
  { code: "both", label: "Lack of efficacy and adverse effects" },
  { code: "other", label: "Other" },
];

export const EMPTY_HISTORY: MdtHistory = { ageAtMdt: "", ageAtOnset: "", handedness: "", riskFactors: [], notes: "" };
export const EMPTY_CHECKLIST: MdtChecklist = { options: [], notes: "" };
export const EMPTY_SAFETY: MdtSafety = { statusEpilepticus: "", statusDetails: "", injuries: "", sudepRisks: [], notes: "" };
export const EMPTY_SOCIAL: MdtSocial = { psychiatric: "", driving: "", employment: "", goals: "" };

export function newAsm(id: string): MdtAsm {
  return { id, drug: "", otherName: "", dose: "", unit: "mg/day", status: "current", reasonStopped: "", note: "" };
}

// ---- Reading saved data ----

const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
/** Known codes only, each once, in list order. */
const codes = (v: unknown, list: ListOption[]) => {
  const picked = new Set(Array.isArray(v) ? v.filter((c): c is string => typeof c === "string") : []);
  return list.filter((o) => picked.has(o.code)).map((o) => o.code);
};

export function normaliseHistory(raw: unknown): MdtHistory {
  const r = obj(raw);
  return {
    ageAtMdt: str(r.ageAtMdt),
    ageAtOnset: str(r.ageAtOnset),
    handedness: oneOf(r.handedness, ["", "right", "left", "ambidextrous"] as const, ""),
    riskFactors: codes(r.riskFactors, RISK_FACTORS),
    notes: str(r.notes),
  };
}

export function normaliseAsms(raw: unknown): MdtAsm[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set([...ASM_LIST.map((a) => a.code), OTHER_ASM]);
  return raw
    .filter((a) => a && typeof a === "object")
    .map((a, i) => {
      const r = obj(a);
      return {
        id: str(r.id) || `asm-${i + 1}`,
        drug: known.has(str(r.drug)) ? str(r.drug) : "",
        otherName: str(r.otherName),
        dose: str(r.dose),
        unit: oneOf(r.unit, ["mg/day", "mg/kg/day"] as const, "mg/day"),
        status: oneOf(r.status, ["current", "previous"] as const, "current"),
        reasonStopped: oneOf(r.reasonStopped, ["", "inefficacy", "adverse", "both", "other"] as const, ""),
        note: str(r.note),
      };
    });
}

export function normaliseChecklist(raw: unknown, list: ListOption[]): MdtChecklist {
  const r = obj(raw);
  return { options: codes(r.options, list), notes: str(r.notes) };
}

export function normaliseSafety(raw: unknown): MdtSafety {
  const r = obj(raw);
  return {
    statusEpilepticus: oneOf(r.statusEpilepticus, ["", "yes", "no"] as const, ""),
    statusDetails: str(r.statusDetails),
    injuries: str(r.injuries),
    sudepRisks: codes(r.sudepRisks, SUDEP_RISKS),
    notes: str(r.notes),
  };
}

export function normaliseSocial(raw: unknown): MdtSocial {
  const r = obj(raw);
  return { psychiatric: str(r.psychiatric), driving: str(r.driving), employment: str(r.employment), goals: str(r.goals) };
}

// ---- Summaries for printing ----

/** A "Label: value" line; an empty label prints the value alone. Values may span lines. */
export interface Fact {
  label: string;
  value: string;
}

/** A printed section of label/value lines. Sections with no facts are left out. */
export interface FactSection {
  heading: string;
  facts: Fact[];
}

const labelsOf = (selected: string[], list: ListOption[]) =>
  list.filter((o) => selected.includes(o.code)).map((o) => o.label);

/** A typed age as a number of years, or null when it isn't one. */
export function parseYears(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

const years = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return `${r} ${r === 1 ? "year" : "years"}`;
};
/** "34 years" for a number, otherwise the text as typed. */
const age = (s: string) => {
  const n = parseYears(s);
  return n === null ? s.trim() : years(n);
};

/** Epilepsy duration in years from the two ages, or null when it can't be worked out. */
export function epilepsyDuration(h: MdtHistory): number | null {
  const now = parseYears(h.ageAtMdt);
  const onset = parseYears(h.ageAtOnset);
  if (now === null || onset === null || onset > now) return null;
  return Math.round((now - onset) * 10) / 10;
}

const fact = (label: string, value: string): Fact[] => (value.trim() ? [{ label, value: value.trim() }] : []);

export function historySection(h: MdtHistory): FactSection {
  const duration = epilepsyDuration(h);
  return {
    heading: "Clinical history",
    facts: [
      ...fact("Age at MDT", age(h.ageAtMdt)),
      ...fact("Age at onset", age(h.ageAtOnset)),
      ...fact("Epilepsy duration", duration === null ? "" : years(duration)),
      ...fact("Handedness", HANDEDNESS.find((o) => o.code === h.handedness)?.label ?? ""),
      ...fact("Early risk factors", labelsOf(h.riskFactors, RISK_FACTORS).join("; ")),
      ...fact("Notes", h.notes),
    ],
  };
}

/** ASMs with a drug chosen (blank rows are left off), current ones first. */
export function filledAsms(asms: MdtAsm[]): MdtAsm[] {
  const named = asms.filter((a) => asmName(a));
  return [...named.filter((a) => a.status === "current"), ...named.filter((a) => a.status === "previous")];
}

export function asmName(a: MdtAsm): string {
  if (a.drug === OTHER_ASM) return a.otherName.trim();
  return ASM_LIST.find((o) => o.code === a.drug)?.label ?? "";
}

export function asmDose(a: MdtAsm): string {
  return a.dose.trim() ? `${a.dose.trim()} ${a.unit}` : "";
}

/** "Current" or "Previous — stopped: lack of efficacy", plus the note. */
export function asmStatus(a: MdtAsm): string {
  let s = a.status === "current" ? "Current" : "Previous";
  if (a.status === "previous" && a.reasonStopped) {
    s += ` — stopped: ${(STOP_REASONS.find((o) => o.code === a.reasonStopped)?.label ?? "").toLowerCase()}`;
  }
  return a.note.trim() ? `${s} (${a.note.trim()})` : s;
}

/** Count lines under the ASM table, and the drug-resistance line when it applies. */
export function asmSummary(asms: MdtAsm[]): string[] {
  const list = filledAsms(asms);
  if (!list.length) return [];
  const current = list.filter((a) => a.status === "current").length;
  const previous = list.length - current;
  const failed = list.filter((a) => a.status === "previous" && (a.reasonStopped === "inefficacy" || a.reasonStopped === "both")).length;
  const lines = [
    `${current} current, ${previous} previous ASM${previous === 1 ? "" : "s"}` +
      (previous ? `; ${failed} stopped for lack of efficacy.` : "."),
  ];
  if (failed >= 2) {
    lines.push(
      "Two or more ASMs stopped for lack of efficacy: consistent with drug-resistant epilepsy (ILAE 2010 definition)."
    );
  }
  return lines;
}

export function treatmentsSection(t: MdtChecklist): FactSection {
  return { heading: "Non-drug treatments", facts: [...fact("", labelsOf(t.options, TREATMENTS).join("; ")), ...fact("Notes", t.notes)] };
}

export function safetySection(s: MdtSafety): FactSection {
  const se = s.statusEpilepticus === "yes" ? "Yes" : s.statusEpilepticus === "no" ? "No" : "";
  const seLine = [se, s.statusDetails.trim()].filter(Boolean).join(" — ");
  return {
    heading: "Status epilepticus and safety",
    facts: [
      ...fact("Status epilepticus", seLine),
      ...fact("Seizure-related injuries", s.injuries),
      ...fact("SUDEP risk factors", labelsOf(s.sudepRisks, SUDEP_RISKS).join("; ")),
      ...fact("Notes", s.notes),
    ],
  };
}

export function diagnosesSection(d: MdtChecklist): FactSection {
  return { heading: "Other relevant diagnoses", facts: [...fact("", labelsOf(d.options, DIAGNOSES).join("; ")), ...fact("Notes", d.notes)] };
}

export function socialSection(s: MdtSocial): FactSection {
  return {
    heading: "Psychiatric and social history",
    facts: [
      ...fact("Psychiatric history", s.psychiatric),
      ...fact("Driving", s.driving),
      ...fact("Employment / education", s.employment),
      ...fact("Patient's goals", s.goals),
    ],
  };
}

/** A section as plain lines, for the PowerPoint notes slide. */
export function sectionPlainText(section: FactSection): string[] {
  if (!section.facts.length) return [];
  return ["", `${section.heading}:`, ...section.facts.map((f) => (f.label ? `${f.label}: ${f.value}` : f.value))];
}
