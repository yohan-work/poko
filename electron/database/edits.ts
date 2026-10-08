import { asc, eq, sql } from "drizzle-orm";
import { type Db, now } from "./common";
import { edits, tasks } from "./schema";

export interface EditRecord {
  id: string;
  taskId: string;
  requestId: string;
  conversationId: string | null;
  workspace: string;
  /** JSON of EditFile[] (see electron/edits/checkpoint.ts). */
  files: string;
  status: "pending" | "applied" | "failed" | "undone" | "expired";
  createdAt: string;
  updatedAt: string;
}

/** A pending edit row, created right before an approved file change is accepted. */
export function createEdit(
  db: Db,
  row: { id: string; taskId: string; requestId: string; workspace: string; files: string },
): void {
  const timestamp = now();
  const conversationId =
    db
      .select({ conversationId: tasks.conversationId })
      .from(tasks)
      .where(eq(tasks.id, row.taskId))
      .get()?.conversationId ?? null;
  db.insert(edits)
    .values({
      ...row,
      conversationId,
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

export function updateEdit(db: Db, id: string, status: EditRecord["status"], files?: string): void {
  db.update(edits)
    .set({ status, updatedAt: now(), ...(files !== undefined ? { files } : {}) })
    .where(eq(edits.id, id))
    .run();
}

export function getEdit(db: Db, id: string): EditRecord | null {
  return (db.select().from(edits).where(eq(edits.id, id)).get() as EditRecord | undefined) ?? null;
}

export function pendingEdits(db: Db, taskId: string): EditRecord[] {
  return db
    .select()
    .from(edits)
    .where(sql`${edits.taskId} = ${taskId} AND ${edits.status} = 'pending'`)
    .all() as EditRecord[];
}

/** Edits shown in a conversation: applied, undone, and expired ones, oldest first. */
export function conversationEdits(db: Db, conversationId: string): EditRecord[] {
  return db
    .select()
    .from(edits)
    .where(
      sql`${edits.conversationId} = ${conversationId} AND ${edits.status} IN ('applied', 'undone', 'expired')`,
    )
    .orderBy(asc(edits.createdAt))
    .all() as EditRecord[];
}

/** Ids of every edit in a conversation, so their checkpoints can be removed with it. */
export function conversationEditIds(db: Db, conversationId: string): string[] {
  return db
    .select({ id: edits.id })
    .from(edits)
    .where(eq(edits.conversationId, conversationId))
    .all()
    .map((row) => row.id);
}

/**
 * Edits older than `before`: applied ones become `expired` (still shown, without undo); ones
 * that never applied (pending or failed) are deleted. Returns every id whose checkpoint goes.
 */
export function expireEdits(db: Db, before: string): string[] {
  const applied = db
    .select({ id: edits.id })
    .from(edits)
    .where(sql`${edits.status} = 'applied' AND ${edits.createdAt} < ${before}`)
    .all();
  for (const row of applied) updateEdit(db, row.id, "expired");
  const stale = sql`${edits.status} IN ('pending', 'failed') AND ${edits.createdAt} < ${before}`;
  const dropped = db.select({ id: edits.id }).from(edits).where(stale).all();
  if (dropped.length) db.delete(edits).where(stale).run();
  return [...applied, ...dropped].map((row) => row.id);
}
