import { app, type BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { basename } from "node:path";
import {
  type AppBootstrap,
  IPC_CHANNELS,
  type PendingApprovalEvent,
  type PersistedConversation,
  type WorkspaceInfo,
} from "../shared";
import type { AgentCore } from "../agent/AgentCore";
import type { CodexAppServerProvider } from "../providers/codex/CodexAppServerProvider";
import { ConversationGoneError, type PokoDatabase } from "../database/Database";
import type { ScreenService } from "../screen/ScreenService";
import type { ScreenOverlay } from "../screen/ScreenOverlay";
import type { ScreenAgent } from "../screen/ScreenAgent";
import type { EditManager } from "../edits/EditManager";
import type { SetupService } from "../setup/SetupService";
import type { QuickPanel } from "../quick/QuickPanel";
import { resolveWorkspaceDirectory } from "../agent/workspace";
import type { ClaudeSetupService } from "../setup/claudeSetup";

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
  /** The running "act" task, if any. Only one task of any kind runs at a time. */
  screenRun: null as { taskId: string; agent: ScreenAgent; done: Promise<void> } | null,
  editManager: null as EditManager | null,
  setupService: null as SetupService | null,
  claudeSetup: null as ClaudeSetupService | null,
  /** Task-starting handlers still running (a start isn't an active task yet). */
  startingTasks: 0,
  /** 모든 데이터 삭제 is in progress; no task may start. */
  deletingData: false,
  quickPanel: null as QuickPanel | null,
  /** False when another app already owns the quick panel shortcut. */
  quickShortcutOk: true,
  /** Shows the main window, creating it if it was closed. Set by main.ts. */
  openMainWindow: null as (() => Promise<void>) | null,
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

export const BUSY_MESSAGE = "포코가 이미 다른 작업을 하고 있어. 끝난 뒤에 다시 물어봐 줘.";

/**
 * Starts a conversation task from either the main window or the quick panel. Refuses before
 * recording anything while another task runs or starts, so a busy refusal never leaves an empty
 * conversation behind. Call only from a `handleTaskStart` handler (it counts this start).
 */
export async function startConversationTask(
  message: string,
  conversationId: string | null,
  /** Runs after the task is recorded and before it starts, so its first event finds it known. */
  onRecorded?: (started: { taskId: string; conversation: PersistedConversation }) => void,
): Promise<{ taskId: string; conversation: PersistedConversation } | { error: string }> {
  if (!ctx.agentCore || !ctx.database) throw new Error("Local storage is unavailable.");
  // This start is already counted in startingTasks, so another start makes it more than one.
  const busy = () => ctx.agentCore?.hasActiveTasks || ctx.screenRun || ctx.startingTasks > 1;
  if (busy()) return { error: BUSY_MESSAGE };
  const cwd = await resolveWorkspaceDirectory(ctx.database.getWorkspace());
  // Another task may have started while the folder was being checked.
  if (busy()) return { error: BUSY_MESSAGE };
  const started = recordTaskStart(ctx.database, message, cwd, conversationId);
  if ("error" in started) return started;
  const { taskId } = started;
  onRecorded?.(started);
  try {
    ctx.agentCore.startTask({
      prompt: message,
      cwd,
      taskId,
      context: ctx.database.getTaskContext(taskId),
      editsEnabled: ctx.database.isEditsEnabled(cwd),
    });
  } catch (error) {
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

/** Whether any task is running or starting, so nothing it uses may be deleted. */
export function anyTaskBusy(): boolean {
  return Boolean(ctx.agentCore?.hasActiveTasks || ctx.screenRun || ctx.startingTasks > 0);
}

/** What the renderer starts from: the workspace, conversations, tasks, and Activity. */
export function bootstrapData(): AppBootstrap {
  if (!ctx.database) throw new Error("The database is not open.");
  const { workspacePath, ...data } = ctx.database.getBootstrapData();
  return { ...data, workspace: workspaceInfo(workspacePath) };
}

export function workspaceInfo(workspacePath: string | null): WorkspaceInfo | null {
  if (!workspacePath) return null;
  return { path: workspacePath, name: basename(workspacePath) };
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
