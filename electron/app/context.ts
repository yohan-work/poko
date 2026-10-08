import { basename, join } from "node:path";
import { app, type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import type { AgentCore } from "../agent/AgentCore";
import type { AgentProvider } from "../agent/AgentProvider";
import { resolveWorkspaceDirectory } from "../agent/workspace";
import {
  attachedTextSection,
  attachmentLine,
  type CheckedAttachment,
  removeAttachments,
  writeImages,
} from "../attachments/attachments";
import { ConversationGoneError, type PokoDatabase } from "../database/Database";
import type { EditManager } from "../edits/EditManager";
import type { CodexAppServerProvider } from "../providers/codex/CodexAppServerProvider";
import type { QuickPanel } from "../quick/QuickPanel";
import type { ScreenAgent } from "../screen/ScreenAgent";
import type { ScreenOverlay } from "../screen/ScreenOverlay";
import type { ScreenService } from "../screen/ScreenService";
import type { ClaudeSetupService } from "../setup/claudeSetup";
import type { SetupService } from "../setup/SetupService";
import {
  type AppBootstrap,
  IPC_CHANNELS,
  type PendingApprovalEvent,
  type PersistedConversation,
  type WorkspaceInfo,
} from "../shared";
import {
  enqueueQuestion,
  hasWaiting,
  kickQueue,
  QUEUE_FULL,
  type QueuedStart,
  releaseSlot,
  reserveSlot,
} from "./queue";

/**
 * Main-process state shared by the IPC handlers: the window, the database, and the services.
 * Set once at startup (see main.ts); handlers read it when they run.
 */
export const ctx = {
  mainWindow: null as BrowserWindow | null,
  agentCore: null as AgentCore | null,
  database: null as PokoDatabase | null,
  screenService: null as ScreenService | null,
  screenOverlay: null as ScreenOverlay | null,
  screenProvider: null as CodexAppServerProvider | null,
  /** The Claude Code provider, for 대신 해 줘 steps when Claude Code is the engine. */
  claudeProvider: null as AgentProvider | null,
  /** The running "act" task, if any. Only one task of any kind runs at a time. */
  screenRun: null as { taskId: string; agent: ScreenAgent; done: Promise<void> } | null,
  editManager: null as EditManager | null,
  setupService: null as SetupService | null,
  claudeSetup: null as ClaudeSetupService | null,
  /** Task-starting handlers still running (a start isn't an active task yet). */
  startingTasks: 0,
  /** 모든 데이터 삭제 is in progress; no task may start. */
  deletingData: false,
  /** Poko is quitting: waiting questions stay waiting (see queue.ts). */
  queueFrozen: false,
  quickPanel: null as QuickPanel | null,
  /** False when another app already owns the quick panel shortcut. */
  quickShortcutOk: true,
  /** Shows the main window, creating it if it was closed. Set by main.ts. */
  openMainWindow: null as (() => Promise<void>) | null,
  /** Where a task's attached images are written while it runs. Set by main.ts. */
  attachmentsRoot: null as string | null,
  /** Rebuilds the menu bar menu (for example after the shortcut changed). Set by main.ts. */
  refreshTray: null as (() => void) | null,
};

/**
 * Approval cards still waiting, per running task, so a main window that opens (or reloads)
 * while a task waits can show them. Removed when answered or when the task ends.
 */
export const pendingApprovalEvents = new Map<string, Map<string, PendingApprovalEvent>>();

/** Whether an IPC call came from the quick panel's own page. */
export function isQuickPanel(event: IpcMainInvokeEvent): boolean {
  return ctx.quickPanel?.owns(event) ?? false;
}

/** Folders holding a running task's attached images, removed when the task ends. */
export const attachmentDirs = new Map<string, string>();

export const BUSY_MESSAGE = "포코가 이미 다른 작업을 하고 있어. 끝난 뒤에 다시 물어봐 줘.";

/**
 * Starts a conversation task from either the main window or the quick panel. Refuses before
 * recording anything while another task runs or starts, so a busy refusal never leaves an empty
 * conversation behind. With `allowQueue` (the main window), a busy Poko queues the question
 * instead. Call only from a `handleTaskStart` handler (it counts this start).
 */
export async function startConversationTask(
  message: string,
  conversationId: string | null,
  /** Runs after the task is recorded and before it starts, so its first event finds it known. */
  onRecorded?: (started: { taskId: string; conversation: PersistedConversation }) => void,
  attachments: CheckedAttachment[] = [],
  options: { allowQueue?: boolean } = {},
): Promise<
  | { taskId: string; conversation: PersistedConversation }
  | QueuedStart
  | { error: string; gone?: boolean }
> {
  if (!ctx.agentCore || !ctx.database) throw new Error("Local storage is unavailable.");
  // This start is already counted in startingTasks, so another start makes it more than one.
  // A waiting question counts too, so a new one never runs ahead of it.
  const busy = () =>
    ctx.agentCore?.hasActiveTasks || ctx.screenRun || ctx.startingTasks > 1 || hasWaiting();
  let queued = false;
  // Holds a place in the queue right away (no await between the check and the hold).
  const wait = (): { error: string } | null => {
    if (!options.allowQueue) return { error: BUSY_MESSAGE };
    if (!reserveSlot()) return { error: QUEUE_FULL };
    queued = true;
    return null;
  };
  if (busy()) {
    const refused = wait();
    if (refused) return refused;
  }
  try {
    const cwd = await resolveWorkspaceDirectory(ctx.database.getWorkspace());
    // Another task may have started while the folder was being checked.
    if (!queued && busy()) {
      const refused = wait();
      if (refused) return refused;
    }
    // A conversation continues only in its own folder, so one project's answers never
    // become another project's context.
    const refused = conversationId ? await folderMismatch(conversationId, cwd) : null;
    if (refused) return { error: refused.message, ...(refused.gone ? { gone: true } : {}) };
    // The conversation shows which files were attached; their content goes only to the engine.
    const line = attachmentLine(attachments);
    const shown = line ? (message ? `${message}\n\n${line}` : line) : message;
    if (queued)
      return await enqueueQuestion({ shown, message, conversationId, folder: cwd, attachments });
    return await startNow(message, shown, cwd, conversationId, attachments, onRecorded);
  } finally {
    if (queued) releaseSlot();
  }
}

async function startNow(
  message: string,
  shown: string,
  cwd: string,
  conversationId: string | null,
  attachments: CheckedAttachment[],
  onRecorded?: (started: { taskId: string; conversation: PersistedConversation }) => void,
): Promise<{ taskId: string; conversation: PersistedConversation } | { error: string }> {
  if (!ctx.agentCore || !ctx.database) throw new Error("Local storage is unavailable.");
  const started = recordTaskStart(ctx.database, shown, cwd, conversationId);
  if ("error" in started) return started;
  const { taskId } = started;
  onRecorded?.(started);
  try {
    const written = ctx.attachmentsRoot
      ? await writeImages(ctx.attachmentsRoot, taskId, attachments)
      : null;
    if (written) attachmentDirs.set(taskId, written.dir);
    const text = attachedTextSection(attachments);
    ctx.agentCore.startTask({
      prompt: [message || "첨부한 파일을 살펴봐 줘.", text].filter(Boolean).join("\n\n"),
      cwd,
      taskId,
      context: ctx.database.getTaskContext(taskId),
      editsEnabled: ctx.database.isEditsEnabled(cwd),
      images: written?.images,
    });
  } catch (error) {
    // Also a folder writeImages left half written before it failed.
    attachmentDirs.delete(taskId);
    if (ctx.attachmentsRoot) void removeAttachments(join(ctx.attachmentsRoot, taskId));
    ctx.database.recordTaskEvent(
      taskId,
      "error",
      "작업을 시작하지 못했어.",
      "작업을 시작하지 못했어.",
    );
    throw error;
  }
  return started;
}

export const folderGoneMessage = (folder: string) =>
  `이 대화의 ${basename(folder)} 폴더를 찾지 못했어. 새 대화에서 물어봐 줘.`;

/**
 * A conversation's folder, resolved now: `resolved` is null when it no longer exists, and the
 * whole result is null when the conversation has no folder yet.
 */
export async function conversationFolder(
  conversationId: string,
): Promise<{ folder: string; resolved: string | null } | null> {
  const folder = ctx.database?.getConversation(conversationId)?.workspacePath;
  if (!folder) return null;
  return { folder, resolved: await resolveWorkspaceDirectory(folder).catch(() => null) };
}

/**
 * Why a conversation can't continue in the selected folder `cwd` (resolved), or null when it
 * can: it has no folder yet, or it resolves to this one (a folder reached through a link too).
 */
export async function folderMismatch(
  conversationId: string,
  cwd: string,
): Promise<{ message: string; gone: boolean } | null> {
  const found = await conversationFolder(conversationId);
  if (!found || found.resolved === cwd) return null;
  if (!found.resolved) return { message: folderGoneMessage(found.folder), gone: true };
  const name = basename(found.folder);
  return {
    message: `이 대화는 ${name} 폴더에서 나눈 대화야. ${name}로 바꾼 뒤 이어서 물어봐 줘.`,
    gone: false,
  };
}

/** Whether any task is running, starting, or waiting, so nothing it uses may be deleted. */
export function anyTaskBusy(): boolean {
  return Boolean(
    ctx.agentCore?.hasActiveTasks || ctx.screenRun || ctx.startingTasks > 0 || hasWaiting(),
  );
}

/** What the renderer starts from: the workspace, conversations, tasks, and Activity. */
export async function bootstrapData(): Promise<AppBootstrap> {
  if (!ctx.database) throw new Error("The database is not open.");
  const { workspacePath, ...data } = ctx.database.getBootstrapData();
  return { ...data, workspace: await workspaceInfo(workspacePath) };
}

export async function workspaceInfo(workspacePath: string | null): Promise<WorkspaceInfo | null> {
  if (!workspacePath) return null;
  const realPath = await resolveWorkspaceDirectory(workspacePath).catch(() => null);
  return { path: workspacePath, name: basename(workspacePath), realPath };
}

export function isTrustedRenderer(event: IpcMainInvokeEvent): boolean {
  return Boolean(
    ctx.mainWindow &&
      !ctx.mainWindow.isDestroyed() &&
      event.sender === ctx.mainWindow.webContents &&
      event.senderFrame === ctx.mainWindow.webContents.mainFrame,
  );
}

/** Conversations a task is being started in, counted until the task is recorded or refused. */
export const startingConversations = new Map<string, number>();

/** Registers a task-starting handler, marking its conversation as starting while it runs. */
export function handleTaskStart(
  channel: string,
  handler: (event: IpcMainInvokeEvent, raw: unknown) => Promise<unknown>,
): void {
  ipcMain.handle(channel, async (event, raw: unknown) => {
    const id =
      typeof raw === "object" && raw !== null && "conversationId" in raw
        ? (raw as { conversationId: unknown }).conversationId
        : null;
    const key = typeof id === "string" ? id : null;
    if (ctx.deletingData) return { error: "데이터를 지우는 중이야. 잠시 뒤에 다시 보내 줘." };
    if (key) startingConversations.set(key, (startingConversations.get(key) ?? 0) + 1);
    ctx.startingTasks += 1;
    try {
      return await handler(event, raw);
    } finally {
      ctx.startingTasks -= 1;
      // A question that queued while this start was in flight may start now.
      if (ctx.startingTasks === 0) kickQueue();
      if (key) {
        const left = (startingConversations.get(key) ?? 1) - 1;
        if (left > 0) startingConversations.set(key, left);
        else startingConversations.delete(key);
      }
    }
  });
}

/** Settles a task's pending edits and tells the renderer when its conversation's edits changed. */
export async function settleEdits(taskId: string): Promise<void> {
  if (!ctx.editManager || !ctx.database) return;
  if (await ctx.editManager.settle(taskId)) {
    const conversation = ctx.database.getTaskConversation(taskId);
    if (conversation) notifyEditsChanged(conversation.id);
  }
}

export function notifyEditsChanged(conversationId: string): void {
  if (!ctx.mainWindow || ctx.mainWindow.isDestroyed() || ctx.mainWindow.webContents.isDestroyed())
    return;
  ctx.mainWindow.webContents.send(IPC_CHANNELS.editsChanged, conversationId);
}

export const CONVERSATION_GONE = "이 대화를 찾을 수 없어. 새 대화로 다시 보내 줘.";

/** A conversation id from the renderer: a short string, or null for a new conversation. */
export function readConversationId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 100)
    throw new TypeError("Invalid conversation id.");
  return value;
}

/**
 * Records the user's message and a running task in the conversation (a new one for null),
 * makes that conversation the active one, and returns it. An id that no longer exists is
 * refused plainly instead of failing in the ctx.database.
 */
export function recordTaskStart(
  store: PokoDatabase,
  message: string,
  workspace: string,
  conversationId: string | null,
): { taskId: string; conversation: PersistedConversation } | { error: string } {
  let taskId: string;
  try {
    taskId = store.createTask(message, workspace, conversationId);
  } catch (error) {
    if (error instanceof ConversationGoneError) return { error: CONVERSATION_GONE };
    throw error;
  }
  const conversation = store.getTaskConversation(taskId);
  if (!conversation) throw new Error("The task's conversation was not recorded.");
  store.setActiveConversation(conversation.id);
  return { taskId, conversation };
}

export function showMainWindow(): void {
  if (!ctx.mainWindow || ctx.mainWindow.isDestroyed()) return;
  if (ctx.mainWindow.isMinimized()) ctx.mainWindow.restore();
  ctx.mainWindow.show();
  app.focus({ steal: true });
}
