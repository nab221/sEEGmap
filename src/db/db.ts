import Dexie, { type Table } from "dexie";
import type { AnatomyRecord, Electrode, FigureId, FreehandSketch, MdtNote, TextAnnotation } from "../types";

export interface SessionMeta {
  key: string; // fixed key "current"
  patientLabel: string;
  planNotes: string;
  /** MDT meeting details. Missing on sessions saved before the MDT note existed. */
  mdt?: MdtNote;
  /** Figure the plan is drawn on. Missing on sessions saved before figures existed = "legacy". */
  figure?: FigureId;
  updatedAt: string;
}

// Note: `anatomy` holds the libraries for *every* figure. Records carry a `figure` field
// (missing = "legacy"); it isn't indexed because the whole table is small and is loaded and
// filtered in memory, so no schema version bump is needed.
class SeegMapDB extends Dexie {
  electrodes!: Table<Electrode, string>;
  anatomy!: Table<AnatomyRecord, string>;
  session!: Table<SessionMeta, string>;
  sketches!: Table<FreehandSketch, string>;
  texts!: Table<TextAnnotation, string>;

  constructor() {
    super("seegmap-db");
    this.version(1).stores({
      electrodes: "id, order, type, name",
      anatomy: "id, targetName, category",
      session: "key",
    });
    this.version(2).stores({
      electrodes: "id, order, type, name",
      anatomy: "id, targetName, category",
      session: "key",
      configOverride: "key",
    });
    this.version(3)
      .stores({
        electrodes: "id, order, type, name",
        anatomy: "id, targetName, category",
        session: "key",
        configOverride: null,
        sketches: "id",
      });
    // v4 adds free-standing text annotations.
    this.version(4).stores({
      electrodes: "id, order, type, name",
      anatomy: "id, targetName, category",
      session: "key",
      sketches: "id",
      texts: "id",
    });
  }
}

export const db = new SeegMapDB();

export async function hasStoredSession(): Promise<boolean> {
  const [electrodeCount, sketchCount, textCount] = await Promise.all([
    db.electrodes.count(),
    db.sketches.count(),
    db.texts.count(),
  ]);
  return electrodeCount > 0 || sketchCount > 0 || textCount > 0;
}

/** Figure the stored session was made on, or null when no session is stored. */
export async function getStoredSessionFigure(): Promise<FigureId | null> {
  const session = await db.session.get("current");
  if (!session) return null;
  return session.figure ?? "legacy";
}

export async function clearSession(): Promise<void> {
  await db.transaction("rw", db.electrodes, db.session, db.sketches, db.texts, async () => {
    await db.electrodes.clear();
    await db.sketches.clear();
    await db.texts.clear();
    await db.session.clear();
  });
}
