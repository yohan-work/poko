import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { asc, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { readWorkspacePath } from "../settings";
import {
  approvals,
  activities,
  conversations,
  edits,
  memories,
  messages,
  settings,
  tasks,
} from "./schema";
import {
  type AppSettings,
  type ApprovalChoice,
  type ApprovalRequest,
  CHECKPOINT_DAY_CHOICES,
  type CheckpointDays,
  type ConversationMatch,
  type EngineId,
  isModelName,
  isReasoningEffort,
  QUICK_SHORTCUTS,
  type ReasoningEffort,
  type QuickShortcut,
} from "../shared";
import { CONTEXT_LIMITS, limitContext, type TaskContext } from "../agent/context";

export type MemoryType = "preference" | "project" | "person" | "decision" | "fact" | "routine";
export interface MemoryRecord {
  id: string;
  type: MemoryType;
  content: string;
  importance: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}
export interface MessageRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}
/** Task summary sent to the renderer at startup. */
export interface TaskRecord {
  id: string;
  title: string;
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
  createdAt: string;
  completedAt: string | null;
}
export interface ActivityRecord {
  id: string;
  taskId: string;
  taskTitle: string;
  type: string;
  message: string;
  createdAt: string;
}
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

export interface ConversationRecord {
  id: string;
  title: string;
  updatedAt: string;
}

/** The renderer sent a conversation that no longer exists. */
export class ConversationGoneError extends Error {
  constructor() {
    super("The conversation no longer exists.");
  }
}

/** A conversation's title: the first message, flattened, at most 40 characters. */
export function conversationTitle(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  return Array.from(flat).slice(0, 40).join("") || "새 대화";
}

export interface BootstrapData {
  workspacePath: string | null;
  /** null: no conversation yet, or a new one about to start. */
  conversationId: string | null;
  conversations: ConversationRecord[];
  messages: MessageRecord[];
  tasks: TaskRecord[];
  activities: ActivityRecord[];
}

const now = (): string => new Date().toISOString();

/** About 70 characters of a message around the first match, on one line. */
export function snippetAround(content: string, needle: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  const start = Math.max(0, at - 25);
  const piece = text.slice(start, start + 70);
  return `${start > 0 ? "…" : ""}${piece}${start + 70 < text.length ? "…" : ""}`;
}

export class PokoDatabase {
  private constructor(
    private readonly client: DatabaseSync,
    private readonly db: ReturnType<typeof drizzle>,
  ) {}

  static async open(
    databasePath: string,
    migrationsPath: string,
    legacySettingsPath?: string,
  ): Promise<PokoDatabase> {
    await mkdir(dirname(databasePath), { recursive: true });
    const client = new DatabaseSync(databasePath);
    try {
      client.exec(
        "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
      );
      const db = drizzle({ client });
      migrate(db, { migrationsFolder: migrationsPath });
      const database = new PokoDatabase(client, db);
      if (legacySettingsPath) await database.importLegacyWorkspace(legacySettingsPath);
      database.recoverInterruptedTasks();
      return database;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  private async importLegacyWorkspace(filePath: string): Promise<void> {
    const existing = this.db.select().from(settings).where(eq(settings.key, "workspacePath")).get();
    if (existing) return;
    try {
      const workspacePath = await readWorkspacePath(filePath);
      if (workspacePath) this.setWorkspace(workspacePath);
    } catch {
      // An absent or invalid legacy settings file is safe to ignore.
    }
  }

  /** Conversations, most recently active first. */
  listConversations(): ConversationRecord[] {
    return this.db
      .select({
        id: conversations.id,
        title: conversations.title,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .orderBy(desc(conversations.updatedAt), desc(sql`${conversations}.rowid`))
      .all();
  }

  getConversation(id: string): ConversationRecord | null {
    return (
      this.db
        .select({
          id: conversations.id,
          title: conversations.title,
          updatedAt: conversations.updatedAt,
        })
        .from(conversations)
        .where(eq(conversations.id, id))
        .get() ?? null
    );
  }

  getConversationMessages(id: string): MessageRecord[] {
    return this.db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt), asc(sql`${messages}.rowid`))
      .all() as MessageRecord[];
  }

  /**
   * The conversation Poko shows: the saved one if it still exists, else the most recently
   * active, else none (the greeting screen).
   */
  getActiveConversationId(): string | null {
    const saved = this.db
      .select()
      .from(settings)
      .where(eq(settings.key, "activeConversationId"))
      .get()?.value;
    if (saved && this.getConversation(saved)) return saved;
    return this.listConversations()[0]?.id ?? null;
  }

  /** null means a new, not yet created conversation. */
  setActiveConversation(id: string | null): void {
    if (id === null) {
      this.db.delete(settings).where(eq(settings.key, "activeConversationId")).run();
      return;
    }
    const timestamp = now();
    this.db
      .insert(settings)
      .values({ key: "activeConversationId", value: id, updatedAt: timestamp })
      .onConflictDoUpdate({ target: settings.key, set: { value: id, updatedAt: timestamp } })
      .run();
  }

  /** A pending edit row, created right before an approved file change is accepted. */
  createEdit(row: {
    id: string;
    taskId: string;
    requestId: string;
    workspace: string;
    files: string;
  }): void {
    const timestamp = now();
    const conversationId =
      this.db
        .select({ conversationId: tasks.conversationId })
        .from(tasks)
        .where(eq(tasks.id, row.taskId))
        .get()?.conversationId ?? null;
    this.db
      .insert(edits)
      .values({
        ...row,
        conversationId,
        status: "pending",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }

  updateEdit(id: string, status: EditRecord["status"], files?: string): void {
    this.db
      .update(edits)
      .set({ status, updatedAt: now(), ...(files !== undefined ? { files } : {}) })
      .where(eq(edits.id, id))
      .run();
  }

  getEdit(id: string): EditRecord | null {
    return (
      (this.db.select().from(edits).where(eq(edits.id, id)).get() as EditRecord | undefined) ?? null
    );
  }

  pendingEdits(taskId: string): EditRecord[] {
    return this.db
      .select()
      .from(edits)
      .where(sql`${edits.taskId} = ${taskId} AND ${edits.status} = 'pending'`)
      .all() as EditRecord[];
  }

  /** Edits shown in a conversation: applied, undone, and expired ones, oldest first. */
  conversationEdits(conversationId: string): EditRecord[] {
    return this.db
      .select()
      .from(edits)
      .where(
        sql`${edits.conversationId} = ${conversationId} AND ${edits.status} IN ('applied', 'undone', 'expired')`,
      )
      .orderBy(asc(edits.createdAt))
      .all() as EditRecord[];
  }

  /** Ids of every edit in a conversation, so their checkpoints can be removed with it. */
  conversationEditIds(conversationId: string): string[] {
    return this.db
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
  expireEdits(before: string): string[] {
    const applied = this.db
      .select({ id: edits.id })
      .from(edits)
      .where(sql`${edits.status} = 'applied' AND ${edits.createdAt} < ${before}`)
      .all();
    for (const row of applied) this.updateEdit(row.id, "expired");
    const stale = sql`${edits.status} IN ('pending', 'failed') AND ${edits.createdAt} < ${before}`;
    const dropped = this.db.select({ id: edits.id }).from(edits).where(stale).all();
    if (dropped.length) this.db.delete(edits).where(stale).run();
    return [...applied, ...dropped].map((row) => row.id);
  }

  /** Whether edits are allowed in a workspace, keyed by its real path (the task's cwd). */
  isEditsEnabled(realPath: string): boolean {
    return (
      this.db
        .select()
        .from(settings)
        .where(eq(settings.key, `editsEnabled:${realPath}`))
        .get()?.value === "true"
    );
  }

  setEditsEnabled(realPath: string, enabled: boolean): void {
    const key = `editsEnabled:${realPath}`;
    if (!enabled) {
      this.db.delete(settings).where(eq(settings.key, key)).run();
      return;
    }
    const timestamp = now();
    this.db
      .insert(settings)
      .values({ key, value: "true", updatedAt: timestamp })
      .onConflictDoUpdate({ target: settings.key, set: { value: "true", updatedAt: timestamp } })
      .run();
  }

  /** The workspace (real path) a task ran in, or null. */
  getTaskWorkspace(taskId: string): string | null {
    return (
      this.db.select({ workspace: tasks.workspace }).from(tasks).where(eq(tasks.id, taskId)).get()
        ?.workspace ?? null
    );
  }

  /** Pending file-change approvals of tasks in a workspace, to decline when edits are turned off. */
  pendingFileChanges(realPath: string): Array<{ taskId: string; requestId: string }> {
    return this.db
      .select({ taskId: approvals.taskId, requestId: approvals.requestId })
      .from(approvals)
      .innerJoin(tasks, eq(tasks.id, approvals.taskId))
      .where(
        sql`${approvals.decision} = 'pending' AND ${approvals.kind} = 'file_change' AND ${tasks.workspace} = ${realPath}`,
      )
      .all();
  }

  /** The kind of a recorded approval request, or null when unknown. */
  getApprovalKind(taskId: string, requestId: string): string | null {
    return (
      this.db
        .select({ kind: approvals.kind })
        .from(approvals)
        .where(sql`${approvals.taskId} = ${taskId} AND ${approvals.requestId} = ${requestId}`)
        .get()?.kind ?? null
    );
  }

  /** Returns false when the conversation doesn't exist. The title is 1–80 characters. */
  renameConversation(id: string, title: string): boolean {
    const clean = title.replace(/\s+/g, " ").trim();
    if (!clean || Array.from(clean).length > 80) throw new TypeError("Invalid title.");
    const result = this.db
      .update(conversations)
      .set({ title: clean })
      .where(eq(conversations.id, id))
      .run();
    return Number(result.changes) > 0;
  }

  /** Whether a running or approval-waiting task belongs to the conversation. */
  hasRunningTask(conversationId: string): boolean {
    return Boolean(
      this.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          sql`${tasks.conversationId} = ${conversationId} AND ${tasks.status} IN ('queued', 'running', 'waiting_approval')`,
        )
        .get(),
    );
  }

  /**
   * Deletes the conversation and its messages. Its tasks and Activity stay as the audit trail,
   * detached from it (ON DELETE SET NULL). A deleted active conversation stops being active.
   */
  deleteConversation(id: string): boolean {
    const deleted = this.db.transaction((tx) => {
      const result = tx.delete(conversations).where(eq(conversations.id, id)).run();
      tx.delete(settings)
        .where(sql`${settings.key} = 'activeConversationId' AND ${settings.value} = ${id}`)
        .run();
      return Number(result.changes) > 0;
    });
    return deleted;
  }

  /** Everything Poko has kept, for 모두 내보내기. Checkpoint file contents are not included. */
  exportAll(): Record<
    "conversations" | "messages" | "tasks" | "activities" | "approvals" | "memories" | "edits",
    unknown[]
  > {
    return {
      conversations: this.db.select().from(conversations).orderBy(conversations.createdAt).all(),
      messages: this.db.select().from(messages).orderBy(messages.createdAt).all(),
      tasks: this.db.select().from(tasks).orderBy(tasks.createdAt).all(),
      activities: this.db.select().from(activities).orderBy(activities.createdAt).all(),
      approvals: this.db.select().from(approvals).orderBy(approvals.createdAt).all(),
      memories: this.db.select().from(memories).orderBy(memories.createdAt).all(),
      edits: this.db.select().from(edits).orderBy(edits.createdAt).all(),
    };
  }

  /**
   * Deletes all history: conversations, messages, tasks, Activity, approvals, memories, and edit
   * records. Settings (workspace, edit switches, the screen notice, preferences) are kept.
   */
  deleteAllHistory(): void {
    this.db.transaction((tx) => {
      for (const table of [approvals, activities, edits, messages, tasks, conversations, memories])
        tx.delete(table).run();
      tx.delete(settings).where(eq(settings.key, "activeConversationId")).run();
    });
  }

  /** The conversation a task belongs to, or null when it was deleted. */
  getTaskConversation(taskId: string): ConversationRecord | null {
    const row = this.db
      .select({ conversationId: tasks.conversationId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get();
    return row?.conversationId ? this.getConversation(row.conversationId) : null;
  }

  getBootstrapData(): BootstrapData {
    const conversationId = this.getActiveConversationId();
    const workspace = this.db
      .select()
      .from(settings)
      .where(eq(settings.key, "workspacePath"))
      .get();
    return {
      workspacePath: workspace?.value ?? null,
      conversationId,
      conversations: this.listConversations(),
      messages: conversationId ? this.getConversationMessages(conversationId) : [],
      // Explicit columns: prompts and results stay in main rather than riding along to the renderer.
      tasks: this.db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          createdAt: tasks.createdAt,
          completedAt: tasks.completedAt,
        })
        .from(tasks)
        .orderBy(desc(tasks.createdAt))
        .limit(100)
        .all(),
      // Join the task title so older activity stays labeled even when its task is not loaded.
      activities: this.db
        .select({
          id: activities.id,
          taskId: activities.taskId,
          taskTitle: tasks.title,
          type: activities.type,
          message: activities.message,
          createdAt: activities.createdAt,
        })
        .from(activities)
        .innerJoin(tasks, eq(tasks.id, activities.taskId))
        // rowid breaks same-millisecond ties so steps keep their insertion order.
        .orderBy(desc(activities.createdAt), desc(sql`${activities}.rowid`))
        .limit(500)
        .all() as ActivityRecord[],
    };
  }

  getWorkspace(): string | null {
    return (
      this.db.select().from(settings).where(eq(settings.key, "workspacePath")).get()?.value ?? null
    );
  }

  getSettings(): AppSettings {
    const rows = this.db
      .select()
      .from(settings)
      .where(
        sql`${settings.key} IN ('memoriesInContext', 'taskNotifications', 'checkpointDays', 'engine', 'codexModel', 'claudeModel', 'codexEffort', 'claudeEffort', 'quickShortcut')`,
      )
      .all();
    const value = (key: string) => rows.find((row) => row.key === key)?.value;
    const days = Number(value("checkpointDays"));
    return {
      engine: value("engine") === "claude" ? "claude" : "codex",
      quickShortcut: (QUICK_SHORTCUTS as readonly string[]).includes(value("quickShortcut") ?? "")
        ? (value("quickShortcut") as QuickShortcut)
        : "Alt+Space",
      codexModel: isModelName(value("codexModel")) ? (value("codexModel") as string) : null,
      claudeModel: isModelName(value("claudeModel")) ? (value("claudeModel") as string) : null,
      codexEffort: isReasoningEffort(value("codexEffort"))
        ? (value("codexEffort") as ReasoningEffort)
        : null,
      claudeEffort: isReasoningEffort(value("claudeEffort"))
        ? (value("claudeEffort") as ReasoningEffort)
        : null,
      memoriesInContext: value("memoriesInContext") !== "false",
      taskNotifications: value("taskNotifications") !== "false",
      checkpointDays: (CHECKPOINT_DAY_CHOICES as readonly number[]).includes(days)
        ? (days as CheckpointDays)
        : 30,
    };
  }

  /** Saves the given preferences; anything invalid is ignored. Returns the saved settings. */
  setSettings(input: Partial<AppSettings>): AppSettings {
    const updates: [string, string][] = [];
    if (input.engine === "codex" || input.engine === "claude")
      updates.push(["engine", input.engine]);
    if ((QUICK_SHORTCUTS as readonly unknown[]).includes(input.quickShortcut))
      updates.push(["quickShortcut", input.quickShortcut as string]);
    if (typeof input.memoriesInContext === "boolean")
      updates.push(["memoriesInContext", String(input.memoriesInContext)]);
    if (typeof input.taskNotifications === "boolean")
      updates.push(["taskNotifications", String(input.taskNotifications)]);
    if ((CHECKPOINT_DAY_CHOICES as readonly unknown[]).includes(input.checkpointDays))
      updates.push(["checkpointDays", String(input.checkpointDays)]);
    const timestamp = now();
    // A model is saved by name, or cleared (back to the CLI's default) with null.
    for (const key of ["codexModel", "claudeModel"] as const) {
      const model = input[key];
      if (model === null) this.db.delete(settings).where(eq(settings.key, key)).run();
      else if (isModelName(model)) updates.push([key, model]);
    }
    // The same for efforts: a known level, or null for the default.
    for (const key of ["codexEffort", "claudeEffort"] as const) {
      const effort = input[key];
      if (effort === null) this.db.delete(settings).where(eq(settings.key, key)).run();
      else if (isReasoningEffort(effort)) updates.push([key, effort]);
    }
    for (const [key, value] of updates)
      this.db
        .insert(settings)
        .values({ key, value, updatedAt: timestamp })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: timestamp } })
        .run();
    return this.getSettings();
  }

  /**
   * The screen notice says where a screenshot goes, which depends on the engine, so it is
   * accepted per engine. Codex keeps the original key.
   */
  private noticeKey(engine: EngineId): string {
    return engine === "codex" ? "screenNoticeAccepted" : `screenNoticeAccepted:${engine}`;
  }

  isScreenNoticeAccepted(engine: EngineId = this.getSettings().engine): boolean {
    return (
      this.db
        .select()
        .from(settings)
        .where(eq(settings.key, this.noticeKey(engine)))
        .get()?.value === "true"
    );
  }

  acceptScreenNotice(engine: EngineId = this.getSettings().engine): void {
    const timestamp = now();
    const key = this.noticeKey(engine);
    this.db
      .insert(settings)
      .values({ key, value: "true", updatedAt: timestamp })
      .onConflictDoUpdate({ target: settings.key, set: { value: "true", updatedAt: timestamp } })
      .run();
  }

  /** Shows the screen notice again (for every engine) before the next screen task. */
  resetScreenNotice(): void {
    this.db.delete(settings).where(sql`${settings.key} LIKE 'screenNoticeAccepted%'`).run();
  }

  setWorkspace(path: string | null): void {
    const timestamp = now();
    if (path === null) {
      this.db.delete(settings).where(eq(settings.key, "workspacePath")).run();
    } else {
      this.db
        .insert(settings)
        .values({ key: "workspacePath", value: path, updatedAt: timestamp })
        .onConflictDoUpdate({ target: settings.key, set: { value: path, updatedAt: timestamp } })
        .run();
    }
  }

  /**
   * Records the user's message and a running task in `conversationId`, or in a new conversation
   * titled from the message when it is null. Throws ConversationGoneError for an id that no
   * longer exists.
   */
  createTask(message: string, workspace: string, conversation: string | null = null): string {
    const id = randomUUID();
    const timestamp = now();
    if (conversation !== null && !this.getConversation(conversation))
      throw new ConversationGoneError();
    const conversationId = conversation ?? randomUUID();
    this.db.transaction((tx) => {
      if (conversation === null)
        tx.insert(conversations)
          .values({
            id: conversationId,
            title: conversationTitle(message),
            createdAt: timestamp,
            updatedAt: timestamp,
          })
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
      tx.insert(tasks)
        .values({
          id,
          title: message.slice(0, 120),
          prompt: message,
          provider: "codex",
          status: "running",
          workspace,
          conversationId,
          createdAt: timestamp,
          completedAt: null,
        })
        .run();
      tx.update(conversations)
        .set({ updatedAt: timestamp })
        .where(eq(conversations.id, conversationId))
        .run();
    });
    return id;
  }

  recordTaskEvent(
    taskId: string,
    type: string,
    activityMessage: string | null,
    result?: string,
  ): void {
    const timestamp = now();
    this.db.transaction((tx) => {
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
  getTaskContext(taskId: string): TaskContext {
    const task = this.db
      .select({ conversationId: tasks.conversationId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get();
    const memoryRows = this.getSettings().memoriesInContext
      ? this.db
          .select({ type: memories.type, content: memories.content })
          .from(memories)
          .orderBy(desc(memories.importance), desc(memories.updatedAt))
          .limit(CONTEXT_LIMITS.memoryCount)
          .all()
      : [];
    const exchangeRows = task?.conversationId
      ? this.db
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

  listMemories(): MemoryRecord[] {
    return this.db
      .select()
      .from(memories)
      .orderBy(desc(memories.updatedAt))
      .all() as MemoryRecord[];
  }

  /**
   * Conversations whose title or messages contain the text, newest first, each with a short
   * piece of its newest matching message.
   */
  searchConversations(query: string, limit = 50): ConversationMatch[] {
    const needle = query.trim();
    if (!needle) return [];
    const pattern = `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
    const titled = this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(sql`${conversations.title} LIKE ${pattern} ESCAPE '\\'`)
      .all();
    // Grouped by conversation first, so a common word can't crowd out older conversations.
    const inMessages = this.db
      .selectDistinct({ conversationId: messages.conversationId })
      .from(messages)
      .where(sql`${messages.content} LIKE ${pattern} ESCAPE '\\'`)
      .all();
    const ids = new Set([
      ...titled.map((row) => row.id),
      ...inMessages.map((row) => row.conversationId),
    ]);
    const found = this.listConversations()
      .filter((conversation) => ids.has(conversation.id))
      .slice(0, limit);
    // Only the shown conversations need a snippet: their newest matching message.
    return found.map((conversation) => {
      const hit = this.db
        .select({ content: messages.content })
        .from(messages)
        .where(
          sql`${messages.conversationId} = ${conversation.id} AND ${messages.content} LIKE ${pattern} ESCAPE '\\'`,
        )
        .orderBy(desc(messages.createdAt))
        .limit(1)
        .get();
      return { ...conversation, snippet: hit ? snippetAround(hit.content, needle) : null };
    });
  }

  searchMemories(query: string): MemoryRecord[] {
    const escaped = query.replace(/[\\%_]/g, "\\$&");
    return this.db
      .select()
      .from(memories)
      .where(sql`${memories.content} LIKE ${`%${escaped}%`} ESCAPE '\\'`)
      .orderBy(desc(memories.updatedAt))
      .all() as MemoryRecord[];
  }

  saveMemory(input: {
    type: MemoryType;
    content: string;
    importance: number;
    source?: string;
  }): MemoryRecord {
    // The same memory twice (two cards for one suggestion, a double click) is kept once.
    const same = this.listMemories().find(
      (memory) =>
        memory.type === input.type &&
        memory.content.trim().toLowerCase() === input.content.trim().toLowerCase(),
    );
    if (same) return same;
    const timestamp = now();
    const record = {
      id: randomUUID(),
      type: input.type,
      content: input.content.trim(),
      importance: input.importance,
      source: input.source ?? "user",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db.insert(memories).values(record).run();
    return record;
  }

  deleteMemory(id: string): boolean {
    return this.db.delete(memories).where(eq(memories.id, id)).run().changes > 0;
  }

  private recoverInterruptedTasks(): void {
    const timestamp = now();
    this.db.transaction((tx) => {
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

  recordApprovalRequest(request: ApprovalRequest): boolean {
    const timestamp = now();
    const canApprove = request.canApprove;
    this.db.transaction((tx) => {
      tx.insert(approvals)
        .values({
          id: randomUUID(),
          taskId: request.taskId,
          requestId: request.requestId,
          kind: request.kind,
          summary: request.summary,
          cwd: request.cwd,
          reason: request.reason,
          decision: canApprove ? "pending" : "denied",
          createdAt: timestamp,
          resolvedAt: canApprove ? null : timestamp,
        })
        .run();
      if (canApprove) {
        tx.update(tasks)
          .set({ status: "waiting_approval" })
          .where(eq(tasks.id, request.taskId))
          .run();
      }
      tx.insert(activities)
        .values({
          id: randomUUID(),
          taskId: request.taskId,
          type: "approval_requested",
          message: canApprove
            ? "포코가 작업 진행을 확인하고 있어."
            : "안전한 확인 정보가 없어 요청을 거절했어.",
          createdAt: timestamp,
        })
        .run();
    });
    return canApprove;
  }

  resolveApproval(taskId: string, requestId: string, choice: ApprovalChoice): boolean {
    const timestamp = now();
    return this.db.transaction((tx) => {
      const pending = tx
        .select({ id: approvals.id })
        .from(approvals)
        .where(
          sql`${approvals.taskId} = ${taskId} AND ${approvals.requestId} = ${requestId} AND ${approvals.decision} = 'pending'`,
        )
        .get();
      if (!pending) return false;
      tx.update(approvals)
        .set({ decision: choice === "approve" ? "approved" : "denied", resolvedAt: timestamp })
        .where(eq(approvals.id, pending.id))
        .run();
      const stillWaiting = tx
        .select({ id: approvals.id })
        .from(approvals)
        .where(sql`${approvals.taskId} = ${taskId} AND ${approvals.decision} = 'pending'`)
        .get();
      if (!stillWaiting) {
        tx.update(tasks).set({ status: "running" }).where(eq(tasks.id, taskId)).run();
      }
      tx.insert(activities)
        .values({
          id: randomUUID(),
          taskId,
          type: choice === "approve" ? "approval_approved" : "approval_denied",
          message:
            choice === "approve" ? "확인했어. 이 요청을 한 번 진행할게." : "요청을 거절했어.",
          createdAt: timestamp,
        })
        .run();
      return true;
    });
  }

  close(): void {
    this.client.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    this.client.close();
  }
}
