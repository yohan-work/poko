import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { type RoutineResult, type RoutineSchedule, readRoutineSchedule } from "../shared";
import { conversationTitle, type Db, now } from "./common";
import { getConversation } from "./conversations";
import { conversations, routines } from "./schema";

/** A routine as main keeps it; times are ISO strings. */
export interface RoutineRecord {
  id: string;
  title: string;
  prompt: string;
  schedule: RoutineSchedule;
  workspacePath: string;
  conversationId: string | null;
  enabled: boolean;
  scheduleChangedAt: string;
  lastSlotAt: string | null;
  lastRunAt: string | null;
  lastResult: RoutineResult | null;
  createdAt: string;
}

function readResult(raw: string | null): RoutineResult | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as RoutineResult;
    return typeof value?.status === "string" && typeof value.at === "string" ? value : null;
  } catch {
    return null;
  }
}

export function listRoutines(db: Db): RoutineRecord[] {
  return db
    .select()
    .from(routines)
    .orderBy(asc(routines.createdAt))
    .all()
    .flatMap((row) => {
      // A schedule that no longer reads (an older format) leaves the routine out.
      const schedule = readRoutineSchedule(JSON.parse(row.schedule));
      if (!schedule) return [];
      return [{ ...row, schedule, lastResult: readResult(row.lastResult) }];
    });
}

export function getRoutine(db: Db, id: string): RoutineRecord | null {
  return listRoutines(db).find((routine) => routine.id === id) ?? null;
}

/**
 * Creates a routine (no id) or changes one. Creating, changing what or when it runs, or
 * turning it back on resets `scheduleChangedAt`, so a time already past never runs.
 */
export function saveRoutine(
  db: Db,
  input: {
    id?: string;
    title: string;
    prompt: string;
    schedule: RoutineSchedule;
    enabled: boolean;
    workspacePath?: string;
  },
): RoutineRecord {
  const timestamp = now();
  const existing = input.id ? getRoutine(db, input.id) : null;
  if (input.id && !existing) throw new Error("The routine no longer exists.");
  const schedule = JSON.stringify(input.schedule);
  if (existing) {
    const reset =
      JSON.stringify(existing.schedule) !== schedule || (input.enabled && !existing.enabled);
    db.update(routines)
      .set({
        title: input.title,
        prompt: input.prompt,
        schedule,
        enabled: input.enabled,
        ...(reset ? { scheduleChangedAt: timestamp } : {}),
      })
      .where(eq(routines.id, existing.id))
      .run();
    return getRoutine(db, existing.id) as RoutineRecord;
  }
  if (!input.workspacePath) throw new Error("A routine needs a folder.");
  const id = randomUUID();
  db.insert(routines)
    .values({
      id,
      title: input.title,
      prompt: input.prompt,
      schedule,
      workspacePath: input.workspacePath,
      conversationId: null,
      enabled: input.enabled,
      scheduleChangedAt: timestamp,
      lastSlotAt: null,
      lastRunAt: null,
      lastResult: null,
      createdAt: timestamp,
    })
    .run();
  return getRoutine(db, id) as RoutineRecord;
}

/** Deletes a routine; its conversation stays. */
export function deleteRoutine(db: Db, id: string): boolean {
  return Number(db.delete(routines).where(eq(routines.id, id)).run().changes) > 0;
}

/**
 * Records how a run went. `slot` marks a scheduled time handled (run or skipped) so it is
 * never tried again; a run the user started has none.
 */
export function recordRoutineRun(
  db: Db,
  id: string,
  result: RoutineResult,
  options: { slot?: string; ran?: boolean } = {},
): void {
  db.update(routines)
    .set({
      lastResult: JSON.stringify(result),
      ...(options.slot ? { lastSlotAt: options.slot } : {}),
      ...(options.ran ? { lastRunAt: result.at } : {}),
    })
    .where(eq(routines.id, id))
    .run();
}

/**
 * The routine's own conversation, "🔁 title", created when it has none (first run, or the
 * user deleted it). Never made the active conversation.
 */
export function ensureRoutineConversation(db: Db, id: string, folder: string): string {
  const routine = getRoutine(db, id);
  if (!routine) throw new Error("The routine no longer exists.");
  const existing = routine.conversationId ? getConversation(db, routine.conversationId) : null;
  // A conversation recorded in another folder is never continued (or relabeled): that would
  // mix two projects' answers, so the routine starts a new one.
  if (existing && (!existing.workspacePath || existing.workspacePath === folder)) {
    if (!existing.workspacePath)
      db.update(conversations)
        .set({ workspacePath: folder })
        .where(eq(conversations.id, existing.id))
        .run();
    return existing.id;
  }
  const conversationId = randomUUID();
  const timestamp = now();
  db.transaction((tx) => {
    tx.insert(conversations)
      .values({
        id: conversationId,
        title: conversationTitle(`🔁 ${routine.title}`),
        workspacePath: folder,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    tx.update(routines).set({ conversationId }).where(eq(routines.id, id)).run();
  });
  return conversationId;
}
