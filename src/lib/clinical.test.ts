import { describe, expect, it } from "vitest";
import {
  ASM_LIST,
  EMPTY_HISTORY,
  asmStatus,
  asmSummary,
  epilepsyDuration,
  filledAsms,
  historySection,
  newAsm,
  normaliseAsms,
  normaliseChecklist,
  normaliseHistory,
  parseYears,
  TREATMENTS,
} from "./clinical";
import type { MdtAsm } from "../types";

const asm = (p: Partial<MdtAsm>): MdtAsm => ({ ...newAsm(p.id ?? Math.random().toString()), ...p });

describe("history", () => {
  it("parses ages and works out the epilepsy duration", () => {
    expect(parseYears("34")).toBe(34);
    expect(parseYears("2,5")).toBe(2.5);
    expect(parseYears("18 months")).toBeNull();
    expect(epilepsyDuration({ ...EMPTY_HISTORY, ageAtMdt: "34", ageAtOnset: "14" })).toBe(20);
    expect(epilepsyDuration({ ...EMPTY_HISTORY, ageAtMdt: "10", ageAtOnset: "14" })).toBeNull();
  });

  it("prints only what was entered, in a fixed order", () => {
    const facts = historySection({
      ageAtMdt: "34",
      ageAtOnset: "14",
      handedness: "left",
      riskFactors: ["family-history", "febrile-complex"],
      notes: "",
    }).facts;
    expect(facts).toEqual([
      { label: "Age at MDT", value: "34 years" },
      { label: "Age at onset", value: "14 years" },
      { label: "Epilepsy duration", value: "20 years" },
      { label: "Handedness", value: "Left" },
      { label: "Early risk factors", value: "Febrile seizures (complex / prolonged); Family history of epilepsy" },
    ]);
    expect(historySection(EMPTY_HISTORY).facts).toEqual([]);
  });
});

describe("ASMs", () => {
  const lev = ASM_LIST.find((a) => a.label === "Levetiracetam")!.code;
  const cbz = ASM_LIST.find((a) => a.label === "Carbamazepine")!.code;
  const ltg = ASM_LIST.find((a) => a.label === "Lamotrigine")!.code;

  it("lists current ones first and drops rows with no drug", () => {
    const list = [
      asm({ id: "1", drug: cbz, status: "previous" }),
      asm({ id: "2", drug: "" }),
      asm({ id: "3", drug: lev, status: "current" }),
      asm({ id: "4", drug: "other", otherName: "" }),
    ];
    expect(filledAsms(list).map((a) => a.id)).toEqual(["3", "1"]);
  });

  it("describes status and reason stopped", () => {
    expect(asmStatus(asm({ status: "current" }))).toBe("Current");
    expect(asmStatus(asm({ status: "previous", reasonStopped: "adverse", note: "rash" }))).toBe(
      "Previous — stopped: adverse effects (rash)"
    );
  });

  it("flags drug resistance after two ASMs stopped for lack of efficacy", () => {
    const one = [asm({ drug: lev }), asm({ drug: cbz, status: "previous", reasonStopped: "inefficacy" })];
    expect(asmSummary(one)).toEqual(["1 current, 1 previous ASM; 1 stopped for lack of efficacy."]);
    const two = [...one, asm({ drug: ltg, status: "previous", reasonStopped: "both" })];
    expect(asmSummary(two)).toHaveLength(2);
    expect(asmSummary(two)[1]).toMatch(/drug-resistant epilepsy/);
    expect(asmSummary([])).toEqual([]);
  });
});

describe("normalising saved data", () => {
  it("fills in missing history and drops unknown codes", () => {
    expect(normaliseHistory(undefined)).toEqual(EMPTY_HISTORY);
    expect(normaliseHistory({ handedness: "both", riskFactors: ["stroke", "made-up", "stroke"] })).toEqual({
      ...EMPTY_HISTORY,
      riskFactors: ["stroke"],
    });
    expect(normaliseChecklist({ options: ["vns", "xyz"], notes: 3 }, TREATMENTS)).toEqual({ options: ["vns"], notes: "" });
  });

  it("repairs ASM rows", () => {
    expect(normaliseAsms([{ drug: "unknown-drug", unit: "g", status: "past" }, null])).toEqual([
      { ...newAsm("asm-1") },
    ]);
  });
});
