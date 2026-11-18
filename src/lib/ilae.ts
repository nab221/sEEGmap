// Seizure types of the ILAE 2025 updated classification (Beniczky et al., Epilepsia 2025,
// doi:10.1111/epi.18338, Table 1 "Taxonomic hierarchy of epileptic seizure classification").
// Main classes are offered as well as types: the paper classifies a seizure under its
// parent term when a detail (e.g. the state of consciousness) can't be determined.
// "Other generalized seizures" is a grouping term, not a type, so it only heads a group.

export interface IlaeSeizureType {
  /** Stored code: the paper's abbreviation where it gives one. */
  code: string;
  /** Name as in Table 1. */
  name: string;
  /** Abbreviation printed after the name, if the paper gives one. */
  abbr?: string;
  /** 0 = main class or type, 1 = subtype of the entry above it. */
  level: 0 | 1;
}

export interface IlaeGroup {
  label: string;
  types: IlaeSeizureType[];
}

export const ILAE_GROUPS: IlaeGroup[] = [
  {
    label: "Focal",
    types: [
      { code: "F", name: "Focal seizure", abbr: "F", level: 0 },
      { code: "FPC", name: "Focal preserved consciousness seizure", abbr: "FPC", level: 1 },
      { code: "FIC", name: "Focal impaired consciousness seizure", abbr: "FIC", level: 1 },
      { code: "FBTC", name: "Focal-to-bilateral tonic-clonic seizure", abbr: "FBTC", level: 1 },
    ],
  },
  {
    label: "Unknown whether focal or generalized",
    types: [
      { code: "U", name: "Unknown whether focal or generalized", abbr: "U", level: 0 },
      { code: "PC", name: "Unknown whether focal or generalized – preserved consciousness seizure", abbr: "PC", level: 1 },
      { code: "IC", name: "Unknown whether focal or generalized – impaired consciousness seizure", abbr: "IC", level: 1 },
      { code: "BTC", name: "Unknown whether focal or generalized – bilateral tonic-clonic seizure", abbr: "BTC", level: 1 },
    ],
  },
  {
    label: "Generalized",
    types: [
      { code: "G", name: "Generalized seizure", abbr: "G", level: 0 },
      { code: "AS", name: "Absence seizure", abbr: "AS", level: 0 },
      { code: "TA", name: "Typical absence seizure", abbr: "TA", level: 1 },
      { code: "AA", name: "Atypical absence seizure", abbr: "AA", level: 1 },
      { code: "MA", name: "Myoclonic absence seizure", abbr: "MA", level: 1 },
      { code: "EMA", name: "Eyelid myoclonia with / without absence", abbr: "EMA", level: 1 },
      { code: "GTC", name: "Generalized tonic-clonic seizure", abbr: "GTC", level: 0 },
      { code: "GTC-M", name: "Myoclonic tonic-clonic seizure", level: 1 },
      { code: "GTC-A", name: "Absence-to-tonic-clonic seizure", level: 1 },
    ],
  },
  {
    label: "Other generalized seizures",
    types: [
      { code: "GM", name: "Generalized myoclonic seizure", abbr: "GM", level: 0 },
      { code: "GC", name: "Generalized clonic seizure", abbr: "GC", level: 0 },
      { code: "GNM", name: "Generalized negative myoclonic seizure", abbr: "GNM", level: 0 },
      { code: "GES", name: "Generalized epileptic spasms", abbr: "GES", level: 0 },
      { code: "GT", name: "Generalized tonic seizure", abbr: "GT", level: 0 },
      { code: "GA", name: "Generalized atonic seizure", abbr: "GA", level: 0 },
      { code: "GMA", name: "Generalized myoclonic-atonic seizure", abbr: "GMA", level: 0 },
    ],
  },
  {
    label: "Unclassified",
    types: [{ code: "UC", name: "Unclassified seizure", level: 0 }],
  },
];

const BY_CODE = new Map(ILAE_GROUPS.flatMap((g) => g.types.map((t) => [t.code, t] as const)));

export function ilaeType(code: string): IlaeSeizureType | undefined {
  return BY_CODE.get(code);
}

/** "Focal impaired consciousness seizure (FIC)", or "" for no / an unknown code. */
export function ilaeTypeName(code: string): string {
  const t = BY_CODE.get(code);
  if (!t) return "";
  return t.abbr ? `${t.name} (${t.abbr})` : t.name;
}

export const ILAE_CITATION = "ILAE 2025 seizure classification (Beniczky et al., Epilepsia 2025)";
