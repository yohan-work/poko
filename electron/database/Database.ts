import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { asc, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { readWorkspacePath } from "../settings";
import { activities, conversations, memories, messages, settings, tasks } from "./schema";

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
export interface TaskRecord {
  id: string;
  title: string;
  prompt: string;
  provider: string;
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
  workspace: string | null;
  createdAt: string;
  completedAt: string | null;
}
export interface ActivityRecord {
  id: string;
  taskId: string;
  type: string;
  message: string;
  createdAt: string;
}
export interface BootstrapData {
  workspacePath: string | null;
  conversationId: string;
  messages: MessageRecord[];
  tasks: TaskRecord[];
  activities: ActivityRecord[];
}

const now = (): string => new Date().toISOString();

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

  private ensureConversation(): string {
    const existing = this.db
      .select({ id: conversations.id })
      .from(conversations)
      .orderBy(asc(conversations.createdAt))
      .get();
    if (existing) return existing.id;
    const id = randomUUID();
    const timestamp = now();
    this.db
      .insert(conversations)
      .values({ id, title: "대화", createdAt: timestamp, updatedAt: timestamp })
      .run();
    return id;
  }

  getBootstrapData(): BootstrapData {
    const conversationId = this.ensureConversation();
    const workspace = this.db
      .select()
      .from(settings)
      .where(eq(settings.key, "workspacePath"))
      .get();
    return {
      workspacePath: workspace?.value ?? null,
      conversationId,
      messages: this.db
        .select({
          id: messages.id,
          role: messages.role,
          content: messages.content,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.createdAt))
        .all() as MessageRecord[],
      tasks: this.db
        .select()
        .from(tasks)
        .orderBy(desc(tasks.createdAt))
        .limit(100)
        .all() as TaskRecord[],
      activities: this.db
        .select()
        .from(activities)
        .orderBy(desc(activities.createdAt))
        .limit(500)
        .all() as ActivityRecord[],
    };
  }

  getWorkspace(): string | null {
    return (
      this.db.select().from(settings).where(eq(settings.key, "workspacePath")).get()?.value ?? null
    );
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

  createTask(message: string, workspace: string): string {
    const id = randomUUID();
    const timestamp = now();
    const conversationId = this.ensureConversation();
    this.db.transaction((tx) => {
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
        tx.update(tasks).set({ status, completedAt: timestamp }).where(eq(tasks.id, taskId)).run();
        if (result !== undefined) {
          const conversationId = this.ensureConversation();
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

  listMemories(): MemoryRecord[] {
    return this.db
      .select()
      .from(memories)
      .orderBy(desc(memories.updatedAt))
      .all() as MemoryRecord[];
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
    this.db
      .update(tasks)
      .set({ status: "failed", completedAt: timestamp })
      .where(eq(tasks.status, "running"))
      .run();
  }

  close(): void {
    this.client.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    this.client.close();
  }
}
