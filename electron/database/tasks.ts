import { randomUUID } from "node:crypto";
import { asc, desc, eq, sql } from "drizzle-orm";
import { CONTEXT_LIMITS, limitContext, type TaskContext } from "../agent/context";
import { conversationTitle, type Db, isFolderPath, now } from "./common";
import { ConversationGoneError, type ConversationRecord, getConversation } from "./conversations";
import { getSettings } from "./preferences";
import { activities, approvals, conversations, memories, messages, tasks } from "./schema";

/**
 * Records the user's message and a running task in `conversationId`, or in a new conversation
 * titled from the message when it is null. Throws ConversationGoneError for an id that no
 * longer exists.
 */
export function createTask(
  db: Db,
  message: string,
  workspace: string,
  conversation: string | null = null,
): string {
  const id = queueTask(db, message, workspace, conversation);
  startQueuedTask(db, id);
  return id;
}

/**
 * Records a question that waits for its turn: only the task, with no message and no new
 * conversation yet, so the conversation keeps its order until it starts (see startQueuedTask).
 * Throws ConversationGoneError for a conversation id that no longer exists.
 */
export function queueTask(
  db: Db,
  message: string,
  workspace: string,
  conversation: string | null = null,
): string {
  if (conversation !== null && !getConversation(db, conversation))
    throw new ConversationGoneError();
  const id = randomUUID();
  db.insert(tasks)
    .values({
      id,
      title: message.slice(0, 120),
      prompt: message,
      provider: "codex",
      status: "queued",
      workspace,
      conversationId: conversation,
      createdAt: now(),
      completedAt: null,
    })
    .run();
  return id;
}

/**
 * Starts a queued task: its conversation (created now for a new one, titled from the message),
 * the user's message, and `running`, together. Returns the conversation id, or null when the
 * task isn't queued.
 */
export function startQueuedTask(db: Db, taskId: string): string | null {
  const timestamp = now();
  return db.transaction((tx) => {
    const task = tx
      .select({
        prompt: tasks.prompt,
        workspace: tasks.workspace,
        conversationId: tasks.conversationId,
        status: tasks.status,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get();
    if (task?.status !== "queued") return null;
    const { prompt: message, workspace } = task;
    const conversationId = task.conversationId ?? randomUUID();
    if (task.conversationId === null)
      tx.insert(conversations)
        .values({
          id: conversationId,
          title: conversationTitle(message),
          workspacePath: isFolderPath(workspace) ? workspace : null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
    // A conversation without a folder yet (older, screen-only, or a routine's) takes this one.
    else if (isFolderPath(workspace))
      tx.update(conversations)
        .set({ workspacePath: workspace })
        .where(
          sql`${conversations.id} = ${conversationId} AND ${conversations.workspacePath} IS NULL`,
        )
        .run();
    tx.insert(messages)
      .values({
        id: randomUUID(),
        conversationId,
        role: "user",
        content: message,
        createdAt: timestamp,
      })
      .run();
    tx.update(tasks).set({ status: "running", conversationId }).where(eq(tasks.id, taskId)).run();
    tx.update(conversations)
      .set({ updatedAt: timestamp })
      .where(eq(conversations.id, conversationId))
      .run();
    return conversationId;
  });
}

export function recordTaskEvent(
  db: Db,
  taskId: string,
  type: string,
  activityMessage: string | null,
  result?: string,
): void {
  const timestamp = now();
  db.transaction((tx) => {
    if (activityMessage)
      tx.insert(activities)
        .values({
          id: randomUUID(),
          taskId,
          type,
          message: activityMessage,
          createdAt: timestamp,
        })
        .run();
    if (type === "completed" || type === "error" || type === "cancelled") {
      const status =
        type === "completed" ? "completed" : type === "cancelled" ? "cancelled" : "failed";
      tx.update(tasks)
        .set({
          status,
          completedAt: timestamp,
          ...(type === "completed" && result !== undefined ? { result } : {}),
        })
        .where(eq(tasks.id, taskId))
        .run();
      // A finished task can no longer act on an unanswered approval.
      tx.update(approvals)
        .set({ decision: type === "cancelled" ? "cancelled" : "expired", resolvedAt: timestamp })
        .where(sql`${approvals.taskId} = ${taskId} AND ${approvals.decision} = 'pending'`)
        .run();
      // The reply belongs to the task's own conversation. A deleted conversation keeps the
      // result on the task only.
      const conversationId = tx
        .select({ conversationId: tasks.conversationId })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get()?.conversationId;
      if (result !== undefined && conversationId) {
        tx.insert(messages)
          .values({
            id: randomUUID(),
            conversationId,
            role: "assistant",
            content: result,
            createdAt: timestamp,
          })
          .run();
        tx.update(conversations)
          .set({ updatedAt: timestamp })
          .where(eq(conversations.id, conversationId))
          .run();
      }
    }
  });
}

/**
 * Context for a task about to start: memories by priority and the most recent completed
 * exchanges from the same conversation (newest first, excluding this task). Caps are applied
 * by `limitContext`.
 */
export function getTaskContext(db: Db, taskId: string): TaskContext {
  const task = db
    .select({ conversationId: tasks.conversationId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  // Shared memories, and the folder memories of this task's own folder only.
  const folder = getTaskWorkspace(db, taskId);
  const memoryRows = getSettings(db).memoriesInContext
    ? db
        .select({ type: memories.type, content: memories.content })
        .from(memories)
        .where(
          isFolderPath(folder)
            ? sql`${memories.workspacePath} IS NULL OR ${memories.workspacePath} = ${folder}`
            : sql`${memories.workspacePath} IS NULL`,
        )
        .orderBy(desc(memories.importance), desc(memories.updatedAt))
        .limit(CONTEXT_LIMITS.memoryCount)
        .all()
    : [];
  const exchangeRows = task?.conversationId
    ? db
        .select({ request: tasks.prompt, answer: tasks.result })
        .from(tasks)
        .where(
          sql`${tasks.conversationId} = ${task.conversationId} AND ${tasks.status} = 'completed' AND ${tasks.result} IS NOT NULL AND ${tasks.id} <> ${taskId}`,
        )
        .orderBy(desc(tasks.createdAt), desc(sql`${tasks}.rowid`))
        .limit(CONTEXT_LIMITS.exchangeCount)
        .all()
    : [];
  return limitContext(
    memoryRows,
    exchangeRows.map((row) => ({ request: row.request, answer: row.answer ?? "" })),
  );
}

/** The newest task in a conversation, or null. */
export function latestTaskId(db: Db, conversationId: string): string | null {
  return (
    db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.conversationId, conversationId))
      .orderBy(desc(tasks.createdAt), desc(sql`${tasks}.rowid`))
      .limit(1)
      .get()?.id ?? null
  );
}

export function hasTask(db: Db, taskId: string): boolean {
  return Boolean(db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).get());
}

/** The workspace a task ran in (a real path, or `screen:{app}`), or null. */
export function getTaskWorkspace(db: Db, taskId: string): string | null {
  return (
    db.select({ workspace: tasks.workspace }).from(tasks).where(eq(tasks.id, taskId)).get()
      ?.workspace ?? null
  );
}

/** Whether a running or approval-waiting task belongs to the conversation. */
export function hasRunningTask(db: Db, conversationId: string): boolean {
  return Boolean(
    db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        sql`${tasks.conversationId} = ${conversationId} AND ${tasks.status} IN ('queued', 'running', 'waiting_approval')`,
      )
      .get(),
  );
}

/** The conversation a task belongs to, or null when it was deleted. */
export function getTaskConversation(db: Db, taskId: string): ConversationRecord | null {
  const row = db
    .select({ conversationId: tasks.conversationId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  return row?.conversationId ? getConversation(db, row.conversationId) : null;
}

/** What a question that was still waiting when Poko quit shows in its conversation. */
export const QUIT_BEFORE_ASKING = "포코가 꺼져서 묻지 못했어.";

/**
 * Tasks left running at an unclean shutdown fail, and their approvals expire. Questions that
 * were still waiting are added to their conversation, failed, so their text isn't lost.
 */
export function recoverInterruptedTasks(db: Db): void {
  const waiting = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.status, "queued"))
    .orderBy(asc(tasks.createdAt), asc(sql`${tasks}.rowid`))
    .all();
  for (const { id } of waiting) {
    startQueuedTask(db, id);
    recordTaskEvent(db, id, "error", QUIT_BEFORE_ASKING, QUIT_BEFORE_ASKING);
  }
  const timestamp = now();
  db.transaction((tx) => {
    tx.update(approvals)
      .set({ decision: "expired", resolvedAt: timestamp })
      .where(eq(approvals.decision, "pending"))
      .run();
    tx.update(tasks)
      .set({ status: "failed", completedAt: timestamp })
      .where(sql`${tasks.status} IN ('running', 'waiting_approval')`)
      .run();
  });
}
