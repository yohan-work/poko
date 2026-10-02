import { globalShortcut, ipcMain } from "electron";
import { IPC_CHANNELS, type QuickShortcut, type TaskStartedNotice } from "../shared";
import { ctx, handleTaskStart, isQuickPanel, startConversationTask } from "./context";

let registered: string | null = null;

/** Registers the quick panel's global shortcut; records whether another app already owns it. */
export function applyQuickShortcut(shortcut: QuickShortcut): void {
  if (registered) globalShortcut.unregister(registered);
  registered = null;
  ctx.quickShortcutOk = true;
  if (shortcut === "off") return;
  const ok = globalShortcut.register(shortcut, () => void ctx.quickPanel?.toggle());
  ctx.quickShortcutOk = ok;
  if (ok) registered = shortcut;
}

/** The quick panel's only channels; each refuses any sender but the panel itself. */
export function registerQuickHandlers(): void {
  handleTaskStart(IPC_CHANNELS.quickAsk, async (event, raw: unknown) => {
    if (!isQuickPanel(event) || !ctx.quickPanel) throw new Error("Unknown sender asked Poko.");
    if (typeof raw !== "string" || !raw.trim() || raw.length > 10_000)
      throw new TypeError("A non-empty question is required.");
    const question = raw.trim();
    let started: Awaited<ReturnType<typeof startConversationTask>>;
    try {
      started = await startConversationTask(question, null);
    } catch (error) {
      // For example no folder selected: the message is already plain Korean.
      started = { error: error instanceof Error ? error.message : "작업을 시작하지 못했어." };
    }
    if ("error" in started) {
      ctx.quickPanel.refuse(question, started.error);
      return { error: started.error };
    }
    ctx.quickPanel.begin(question, started.taskId, started.conversation.id);
    // The main window adds the conversation and task, and adopts it when shown.
    const notice: TaskStartedNotice = {
      taskId: started.taskId,
      title: question,
      conversation: started.conversation,
    };
    if (ctx.mainWindow && !ctx.mainWindow.isDestroyed())
      ctx.mainWindow.webContents.send(IPC_CHANNELS.taskStarted, notice);
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.quickHide, (event) => {
    if (!isQuickPanel(event)) throw new Error("Unknown sender hid the panel.");
    ctx.quickPanel?.hide();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.quickResize, (event, raw: unknown) => {
    if (!isQuickPanel(event)) throw new Error("Unknown sender resized the panel.");
    if (typeof raw === "number" && Number.isFinite(raw)) ctx.quickPanel?.resize(raw);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.quickOpenInApp, async (event, raw: unknown) => {
    if (!isQuickPanel(event)) throw new Error("Unknown sender opened the app.");
    const conversationId = typeof raw === "string" && raw.length <= 100 ? raw : null;
    ctx.quickPanel?.hide();
    await ctx.openMainWindow?.();
    if (conversationId && ctx.mainWindow && !ctx.mainWindow.isDestroyed())
      ctx.mainWindow.webContents.send(IPC_CHANNELS.appFocusConversation, conversationId);
    return true;
  });
}
