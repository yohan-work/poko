import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("messages_conversation_created_idx").on(table.conversationId, table.createdAt)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    provider: text("provider").notNull(),
    status: text("status", {
      enum: ["queued", "running", "waiting_approval", "completed", "failed", "cancelled"],
    }).notNull(),
    workspace: text("workspace"),
    // Tasks outlive their conversation: deleting a conversation keeps task, Activity, and approval history.
    conversationId: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    /** Poko's final answer, set only when the task completes. */
    result: text("result"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("tasks_created_idx").on(table.createdAt),
    index("tasks_status_idx").on(table.status),
    index("tasks_conversation_created_idx").on(table.conversationId, table.createdAt),
  ],
);

export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("activities_task_created_idx").on(table.taskId, table.createdAt)],
);

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    type: text("type", {
      enum: ["preference", "project", "person", "decision", "fact", "routine"],
    }).notNull(),
    content: text("content").notNull(),
    importance: integer("importance").notNull().default(3),
    source: text("source").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("memories_type_updated_idx").on(table.type, table.updatedAt)],
);

export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    kind: text("kind", { enum: ["command", "file_change", "screen_action"] }).notNull(),
    summary: text("summary").notNull(),
    cwd: text("cwd"),
    reason: text("reason"),
    decision: text("decision", {
      enum: ["pending", "approved", "denied", "expired", "cancelled"],
    }).notNull(),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    index("approvals_task_created_idx").on(table.taskId, table.createdAt),
    uniqueIndex("approvals_task_request_unique_idx").on(table.taskId, table.requestId),
  ],
);

export const schema = { settings, conversations, messages, tasks, activities, memories, approvals };

/**
 * An approved file change and its checkpoint (Phase 08). `files` is JSON: for each file its real
 * path, whether it existed before (its bytes are in the checkpoint folder), and its state after
 * the change (a SHA-256, "absent", or null until known).
 */
export const edits = sqliteTable(
  "edits",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    conversationId: text("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    workspace: text("workspace").notNull(),
    files: text("files").notNull(),
    status: text("status", {
      enum: ["pending", "applied", "failed", "undone", "expired"],
    }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("edits_conversation_created_idx").on(table.conversationId, table.createdAt)],
);
