import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("tasks_created_idx").on(table.createdAt),
    index("tasks_status_idx").on(table.status),
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

export const schema = { settings, conversations, messages, tasks, activities, memories };
