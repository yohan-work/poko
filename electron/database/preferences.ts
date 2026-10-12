import { sql } from "drizzle-orm";
import {
  type AppSettings,
  CHECKPOINT_DAY_CHOICES,
  type CheckpointDays,
  type EngineId,
  isModelName,
  isReasoningEffort,
  QUICK_SHORTCUTS,
  type QuickShortcut,
  type ReasoningEffort,
} from "../shared";
import { type Db, deleteSetting, readSetting, writeSetting } from "./common";
import { settings } from "./schema";

export function getWorkspace(db: Db): string | null {
  return readSetting(db, "workspacePath");
}

export function setWorkspace(db: Db, path: string | null): void {
  if (path === null) deleteSetting(db, "workspacePath");
  else writeSetting(db, "workspacePath", path);
}

export function getSettings(db: Db): AppSettings {
  const rows = db
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
export function setSettings(db: Db, input: Partial<AppSettings>): AppSettings {
  const updates: [string, string][] = [];
  if (input.engine === "codex" || input.engine === "claude") updates.push(["engine", input.engine]);
  if ((QUICK_SHORTCUTS as readonly unknown[]).includes(input.quickShortcut))
    updates.push(["quickShortcut", input.quickShortcut as string]);
  if (typeof input.memoriesInContext === "boolean")
    updates.push(["memoriesInContext", String(input.memoriesInContext)]);
  if (typeof input.taskNotifications === "boolean")
    updates.push(["taskNotifications", String(input.taskNotifications)]);
  if ((CHECKPOINT_DAY_CHOICES as readonly unknown[]).includes(input.checkpointDays))
    updates.push(["checkpointDays", String(input.checkpointDays)]);
  // A model is saved by name, or cleared (back to the CLI's default) with null.
  for (const key of ["codexModel", "claudeModel"] as const) {
    const model = input[key];
    if (model === null) deleteSetting(db, key);
    else if (isModelName(model)) updates.push([key, model]);
  }
  // The same for efforts: a known level, or null for the default.
  for (const key of ["codexEffort", "claudeEffort"] as const) {
    const effort = input[key];
    if (effort === null) deleteSetting(db, key);
    else if (isReasoningEffort(effort)) updates.push([key, effort]);
  }
  for (const [key, value] of updates) writeSetting(db, key, value);
  return getSettings(db);
}

/**
 * The screen notice says where a screenshot goes, which depends on the engine, so it is
 * accepted per engine. Codex keeps the original key.
 */
const noticeKey = (engine: EngineId): string =>
  engine === "codex" ? "screenNoticeAccepted" : `screenNoticeAccepted:${engine}`;

export function isScreenNoticeAccepted(db: Db, engine: EngineId = getSettings(db).engine): boolean {
  return readSetting(db, noticeKey(engine)) === "true";
}

export function acceptScreenNotice(db: Db, engine: EngineId = getSettings(db).engine): void {
  writeSetting(db, noticeKey(engine), "true");
}

/** Shows the screen notice again (for every engine) before the next screen task. */
export function resetScreenNotice(db: Db): void {
  db.delete(settings).where(sql`${settings.key} LIKE 'screenNoticeAccepted%'`).run();
}

/** Whether edits are allowed in a workspace, keyed by its real path (the task's cwd). */
export function isEditsEnabled(db: Db, realPath: string): boolean {
  return readSetting(db, `editsEnabled:${realPath}`) === "true";
}

export function setEditsEnabled(db: Db, realPath: string, enabled: boolean): void {
  const key = `editsEnabled:${realPath}`;
  if (enabled) writeSetting(db, key, "true");
  else deleteSetting(db, key);
}
