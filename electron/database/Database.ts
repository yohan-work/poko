import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import type { TaskContext } from "../agent/context";
import { readWorkspacePath } from "../settings";
import type {
  ApprovalChoice,
  ApprovalRequest,
  AppSettings,
  ConversationMatch,
  EngineId,
  RoutineResult,
  RoutineSchedule,
} from "../shared";
import * as Approvals from "./approvals";
import type { Db } from "./common";
import type { ConversationRecord, MessageRecord } from "./conversations";
import * as Conversations from "./conversations";
import type { EditRecord } from "./edits";
import * as Edits from "./edits";
import type { MemoryRecord, MemoryType } from "./memories";
import * as Memories from "./memories";
import * as Preferences from "./preferences";
import type { RoutineRecord } from "./routines";
import * as Routines from "./routines";
import {
  activities,
  approvals,
  conversations,
  edits,
  memories,
  messages,
  routines,
  settings,
  tasks,
} from "./schema";
import * as Tasks from "./tasks";

export { conversationTitle, isFolderPath } from "./common";
export {
  ConversationGoneError,
  type ConversationRecord,
  type MessageRecord,
  snippetAround,
} from "./conversations";
export type { EditRecord } from "./edits";
export type { MemoryRecord, MemoryType } from "./memories";
export type { RoutineRecord } from "./routines";

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

export interface BootstrapData {
  workspacePath: string | null;
  /** null: no conversation yet, or a new one about to start. */
  conversationId: string | null;
  conversations: ConversationRecord[];
  messages: MessageRecord[];
  tasks: TaskRecord[];
  activities: ActivityRecord[];
}

/**
 * The main process's database. Queries live in one module per area (conversations, tasks,
 * approvals, edits, memories, routines, preferences); this class owns the connection and
 * what spans every area: startup, bootstrap, export, and deleting all history.
 */
export class PokoDatabase {
  private constructor(
    private readonly client: DatabaseSync,
    private readonly db: Db,
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
      Tasks.recoverInterruptedTasks(db);
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

  getBootstrapData(): BootstrapData {
    const conversationId = this.getActiveConversationId();
    return {
      workspacePath: this.getWorkspace(),
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

  /** Everything Poko has kept, for 모두 내보내기. Checkpoint file contents are not included. */
  exportAll(): Record<
    | "conversations"
    | "messages"
    | "tasks"
    | "activities"
    | "approvals"
    | "memories"
    | "edits"
    | "routines",
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
      routines: this.db.select().from(routines).orderBy(routines.createdAt).all(),
    };
  }

  /**
   * Deletes all history: conversations, messages, tasks, Activity, approvals, memories, edit
   * records, and routines. Settings (workspace, edit switches, the screen notice, preferences) are kept.
   */
  deleteAllHistory(): void {
    this.db.transaction((tx) => {
      for (const table of [
        approvals,
        activities,
        edits,
        messages,
        tasks,
        routines,
        conversations,
        memories,
      ])
        tx.delete(table).run();
      tx.delete(settings).where(eq(settings.key, "activeConversationId")).run();
    });
  }

  close(): void {
    this.client.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    this.client.close();
  }

  // Conversations

  listConversations(): ConversationRecord[] {
    return Conversations.listConversations(this.db);
  }
  getConversation(id: string): ConversationRecord | null {
    return Conversations.getConversation(this.db, id);
  }
  getConversationMessages(id: string): MessageRecord[] {
    return Conversations.getConversationMessages(this.db, id);
  }
  getActiveConversationId(): string | null {
    return Conversations.getActiveConversationId(this.db);
  }
  setActiveConversation(id: string | null): void {
    Conversations.setActiveConversation(this.db, id);
  }
  renameConversation(id: string, title: string): boolean {
    return Conversations.renameConversation(this.db, id, title);
  }
  deleteConversation(id: string): boolean {
    return Conversations.deleteConversation(this.db, id);
  }
  searchConversations(query: string, limit?: number): ConversationMatch[] {
    return Conversations.searchConversations(this.db, query, limit);
  }

  // Tasks

  createTask(message: string, workspace: string, conversation: string | null = null): string {
    return Tasks.createTask(this.db, message, workspace, conversation);
  }
  recordTaskEvent(
    taskId: string,
    type: string,
    activityMessage: string | null,
    result?: string,
  ): void {
    Tasks.recordTaskEvent(this.db, taskId, type, activityMessage, result);
  }
  getTaskContext(taskId: string): TaskContext {
    return Tasks.getTaskContext(this.db, taskId);
  }
  latestTaskId(conversationId: string): string | null {
    return Tasks.latestTaskId(this.db, conversationId);
  }
  hasTask(taskId: string): boolean {
    return Tasks.hasTask(this.db, taskId);
  }
  getTaskWorkspace(taskId: string): string | null {
    return Tasks.getTaskWorkspace(this.db, taskId);
  }
  hasRunningTask(conversationId: string): boolean {
    return Tasks.hasRunningTask(this.db, conversationId);
  }
  getTaskConversation(taskId: string): ConversationRecord | null {
    return Tasks.getTaskConversation(this.db, taskId);
  }

  // Approvals

  recordApprovalRequest(request: ApprovalRequest): boolean {
    return Approvals.recordApprovalRequest(this.db, request);
  }
  resolveApproval(taskId: string, requestId: string, choice: ApprovalChoice): boolean {
    return Approvals.resolveApproval(this.db, taskId, requestId, choice);
  }
  pendingFileChanges(realPath: string): Array<{ taskId: string; requestId: string }> {
    return Approvals.pendingFileChanges(this.db, realPath);
  }
  getApprovalKind(taskId: string, requestId: string): string | null {
    return Approvals.getApprovalKind(this.db, taskId, requestId);
  }

  // Edits

  createEdit(row: {
    id: string;
    taskId: string;
    requestId: string;
    workspace: string;
    files: string;
  }): void {
    Edits.createEdit(this.db, row);
  }
  updateEdit(id: string, status: EditRecord["status"], files?: string): void {
    Edits.updateEdit(this.db, id, status, files);
  }
  getEdit(id: string): EditRecord | null {
    return Edits.getEdit(this.db, id);
  }
  pendingEdits(taskId: string): EditRecord[] {
    return Edits.pendingEdits(this.db, taskId);
  }
  conversationEdits(conversationId: string): EditRecord[] {
    return Edits.conversationEdits(this.db, conversationId);
  }
  conversationEditIds(conversationId: string): string[] {
    return Edits.conversationEditIds(this.db, conversationId);
  }
  expireEdits(before: string): string[] {
    return Edits.expireEdits(this.db, before);
  }

  // Memories

  listMemories(): MemoryRecord[] {
    return Memories.listMemories(this.db);
  }
  searchMemories(query: string): MemoryRecord[] {
    return Memories.searchMemories(this.db, query);
  }
  saveMemory(
    input: { type: MemoryType; content: string; importance: number; source?: string },
    folder: string | null = null,
  ): MemoryRecord {
    return Memories.saveMemory(this.db, input, folder);
  }
  updateMemory(id: string, content: string): MemoryRecord | "duplicate" | null {
    return Memories.updateMemory(this.db, id, content);
  }
  deleteMemory(id: string): boolean {
    return Memories.deleteMemory(this.db, id);
  }

  // Routines

  listRoutines(): RoutineRecord[] {
    return Routines.listRoutines(this.db);
  }
  getRoutine(id: string): RoutineRecord | null {
    return Routines.getRoutine(this.db, id);
  }
  saveRoutine(input: {
    id?: string;
    title: string;
    prompt: string;
    schedule: RoutineSchedule;
    enabled: boolean;
    workspacePath?: string;
  }): RoutineRecord {
    return Routines.saveRoutine(this.db, input);
  }
  deleteRoutine(id: string): boolean {
    return Routines.deleteRoutine(this.db, id);
  }
  recordRoutineRun(
    id: string,
    result: RoutineResult,
    options?: { slot?: string; ran?: boolean },
  ): void {
    Routines.recordRoutineRun(this.db, id, result, options);
  }
  ensureRoutineConversation(id: string, folder: string): string {
    return Routines.ensureRoutineConversation(this.db, id, folder);
  }

  // Preferences

  getWorkspace(): string | null {
    return Preferences.getWorkspace(this.db);
  }
  setWorkspace(path: string | null): void {
    Preferences.setWorkspace(this.db, path);
  }
  getSettings(): AppSettings {
    return Preferences.getSettings(this.db);
  }
  setSettings(input: Partial<AppSettings>): AppSettings {
    return Preferences.setSettings(this.db, input);
  }
  isScreenNoticeAccepted(engine?: EngineId): boolean {
    return Preferences.isScreenNoticeAccepted(this.db, engine);
  }
  acceptScreenNotice(engine?: EngineId): void {
    Preferences.acceptScreenNotice(this.db, engine);
  }
  resetScreenNotice(): void {
    Preferences.resetScreenNotice(this.db);
  }
  isEditsEnabled(realPath: string): boolean {
    return Preferences.isEditsEnabled(this.db, realPath);
  }
  setEditsEnabled(realPath: string, enabled: boolean): void {
    Preferences.setEditsEnabled(this.db, realPath, enabled);
  }
}
