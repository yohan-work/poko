import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/node-sqlite";
import { settings } from "./schema";

/** The Drizzle handle every area module queries through. */
export type Db = ReturnType<typeof drizzle>;

export const now = (): string => new Date().toISOString();

/** A task's workspace that is a folder; screen tasks store `screen:{app}` instead. */
export const isFolderPath = (workspace: string | null | undefined): workspace is string =>
  typeof workspace === "string" && workspace.startsWith("/");

/** A conversation's title: the first message, flattened, at most 40 characters. */
export function conversationTitle(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  return Array.from(flat).slice(0, 40).join("") || "새 대화";
}

export function readSetting(db: Db, key: string): string | null {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

export function writeSetting(db: Db, key: string, value: string): void {
  const timestamp = now();
  db.insert(settings)
    .values({ key, value, updatedAt: timestamp })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: timestamp } })
    .run();
}

export function deleteSetting(db: Db, key: string): void {
  db.delete(settings).where(eq(settings.key, key)).run();
}
