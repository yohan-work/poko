import { asc, desc, eq, sql } from "drizzle-orm";
import type { ConversationMatch } from "../shared";
import { type Db, deleteSetting, readSetting, writeSetting } from "./common";
import { conversations, messages, settings } from "./schema";

export interface ConversationRecord {
  id: string;
  title: string;
  updatedAt: string;
  /** The resolved folder it works in, or null before its first task in a real folder. */
  workspacePath: string | null;
}

export interface MessageRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

/** The renderer sent a conversation that no longer exists. */
export class ConversationGoneError extends Error {
  constructor() {
    super("The conversation no longer exists.");
  }
}

/** About 70 characters of a message around the first match, on one line. */
export function snippetAround(content: string, needle: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  const start = Math.max(0, at - 25);
  const piece = text.slice(start, start + 70);
  return `${start > 0 ? "…" : ""}${piece}${start + 70 < text.length ? "…" : ""}`;
}

const conversationColumns = {
  id: conversations.id,
  title: conversations.title,
  updatedAt: conversations.updatedAt,
  workspacePath: conversations.workspacePath,
};

/** Conversations, most recently active first. */
export function listConversations(db: Db): ConversationRecord[] {
  return db
    .select(conversationColumns)
    .from(conversations)
    .orderBy(desc(conversations.updatedAt), desc(sql`${conversations}.rowid`))
    .all();
}

export function getConversation(db: Db, id: string): ConversationRecord | null {
  return (
    db.select(conversationColumns).from(conversations).where(eq(conversations.id, id)).get() ?? null
  );
}

export function getConversationMessages(db: Db, id: string): MessageRecord[] {
  return db
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
export function getActiveConversationId(db: Db): string | null {
  const saved = readSetting(db, "activeConversationId");
  if (saved && getConversation(db, saved)) return saved;
  return listConversations(db)[0]?.id ?? null;
}

/** null means a new, not yet created conversation. */
export function setActiveConversation(db: Db, id: string | null): void {
  if (id === null) deleteSetting(db, "activeConversationId");
  else writeSetting(db, "activeConversationId", id);
}

/** Returns false when the conversation doesn't exist. The title is 1–80 characters. */
export function renameConversation(db: Db, id: string, title: string): boolean {
  const clean = title.replace(/\s+/g, " ").trim();
  if (!clean || Array.from(clean).length > 80) throw new TypeError("Invalid title.");
  const result = db
    .update(conversations)
    .set({ title: clean })
    .where(eq(conversations.id, id))
    .run();
  return Number(result.changes) > 0;
}

/**
 * Deletes the conversation and its messages. Its tasks and Activity stay as the audit trail,
 * detached from it (ON DELETE SET NULL). A deleted active conversation stops being active.
 */
export function deleteConversation(db: Db, id: string): boolean {
  return db.transaction((tx) => {
    const result = tx.delete(conversations).where(eq(conversations.id, id)).run();
    tx.delete(settings)
      .where(sql`${settings.key} = 'activeConversationId' AND ${settings.value} = ${id}`)
      .run();
    return Number(result.changes) > 0;
  });
}

/**
 * Conversations whose title or messages contain the text, newest first, each with a short
 * piece of its newest matching message.
 */
export function searchConversations(db: Db, query: string, limit = 50): ConversationMatch[] {
  const needle = query.trim();
  if (!needle) return [];
  const pattern = `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
  const titled = db
    .select({ id: conversations.id })
    .from(conversations)
    .where(sql`${conversations.title} LIKE ${pattern} ESCAPE '\\'`)
    .all();
  // Grouped by conversation first, so a common word can't crowd out older conversations.
  const inMessages = db
    .selectDistinct({ conversationId: messages.conversationId })
    .from(messages)
    .where(sql`${messages.content} LIKE ${pattern} ESCAPE '\\'`)
    .all();
  const ids = new Set([
    ...titled.map((row) => row.id),
    ...inMessages.map((row) => row.conversationId),
  ]);
  const found = listConversations(db)
    .filter((conversation) => ids.has(conversation.id))
    .slice(0, limit);
  // Only the shown conversations need a snippet: their newest matching message.
  return found.map((conversation) => {
    const hit = db
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
