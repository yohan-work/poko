import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { isSameMemory } from "../shared";
import { type Db, now } from "./common";
import { memories } from "./schema";

export type MemoryType = "preference" | "project" | "person" | "decision" | "fact" | "routine";
export interface MemoryRecord {
  id: string;
  type: MemoryType;
  content: string;
  workspacePath: string | null;
  importance: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export function listMemories(db: Db): MemoryRecord[] {
  return db.select().from(memories).orderBy(desc(memories.updatedAt)).all() as MemoryRecord[];
}

export function searchMemories(db: Db, query: string): MemoryRecord[] {
  const escaped = query.replace(/[\\%_]/g, "\\$&");
  return db
    .select()
    .from(memories)
    .where(sql`${memories.content} LIKE ${`%${escaped}%`} ESCAPE '\\'`)
    .orderBy(desc(memories.updatedAt))
    .all() as MemoryRecord[];
}

/**
 * Saves a memory in `folder` (a resolved path; null: every folder). The caller decides the
 * folder: only 프로젝트 and 결정 memories have one.
 */
export function saveMemory(
  db: Db,
  input: { type: MemoryType; content: string; importance: number; source?: string },
  folder: string | null = null,
): MemoryRecord {
  // The same memory twice (two cards for one suggestion, a double click, or one already
  // shared with every folder) is kept once.
  const same = listMemories(db).find((memory) =>
    isSameMemory(memory, { type: input.type, content: input.content, workspacePath: folder }),
  );
  if (same) return same;
  const timestamp = now();
  const record = {
    id: randomUUID(),
    type: input.type,
    content: input.content.trim(),
    workspacePath: folder,
    importance: input.importance,
    source: input.source ?? "user",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.insert(memories).values(record).run();
  return record;
}

/**
 * Changes what a memory says; its type and folder stay. Refused (null) when the memory is
 * gone or another memory where it applies already says the same.
 */
export function updateMemory(
  db: Db,
  id: string,
  content: string,
): MemoryRecord | "duplicate" | null {
  const all = listMemories(db);
  const memory = all.find((item) => item.id === id);
  if (!memory) return null;
  const wanted = { type: memory.type, content, workspacePath: memory.workspacePath };
  // Both ways: a shared memory may not repeat a folder memory either (both would reach it).
  const repeats = (item: MemoryRecord) =>
    isSameMemory(item, wanted) ||
    (memory.workspacePath === null && isSameMemory({ ...item, workspacePath: null }, wanted));
  if (all.some((item) => item.id !== id && repeats(item))) return "duplicate";
  const updatedAt = now();
  db.update(memories).set({ content: content.trim(), updatedAt }).where(eq(memories.id, id)).run();
  return { ...memory, content: content.trim(), updatedAt };
}

export function deleteMemory(db: Db, id: string): boolean {
  return db.delete(memories).where(eq(memories.id, id)).run().changes > 0;
}
