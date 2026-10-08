import { globalShortcut, ipcMain } from "electron";
import {
  IPC_CHANNELS,
  type PersistedConversation,
  type QuickShortcut,
  type TaskStartedNotice,
} from "../shared";
import {
  CONVERSATION_GONE,
  ctx,
  handleTaskStart,
  isQuickPanel,
  startConversationTask,
  startingConversations,
} from "./context";

/** Whether `taskId` is still the conversation's latest task (null: a refused question). */
function isLatestTurn(conversationId: string, taskId: string | null): boolean {
  return taskId === null || ctx.database?.latestTaskId(conversationId) === taskId;
}
import { cancelQueued } from "./queue";
import { startScreenLook } from "./screen";
import { memoryFolder } from "./workspace";

let registered: string | null = null;
/**
 * The window that was in front when the panel opened. Kept in main: the panel only learns its
 * app and title, and can only ask to include it, never name another window.
 */
let frontWindowId: number | null = null;
/** The text selected in the app in front when the panel opened; the panel sees a preview only. */
let selectedText: string | null = null;

/** One line for the chip: the selection's start, spaces folded. */
function selectionPreview(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}

/** Why a question can't include the screen right now, or null when it can. */
async function screenHint(): Promise<string | null> {
  if (!ctx.screenService?.supported || !ctx.database)
    return "이 컴퓨터에서는 화면 보기를 쓸 수 없어.";
  const status = await ctx.screenService.status(ctx.database.isScreenNoticeAccepted());
  if (!status.permissions.screen || !status.permissions.accessibility)
    return "화면과 함께 물으려면 앱의 화면 보기에서 권한을 먼저 허용해 줘.";
  if (!status.noticeAccepted) return "화면과 함께 물으려면 앱의 화면 보기 안내를 먼저 확인해 줘.";
  return null;
}

/**
 * Opens the quick panel, or hides it when it is open. The front window is read before the
 * panel takes focus, so it is the one the user was looking at.
 */
export async function toggleQuickPanel(): Promise<void> {
  const panel = ctx.quickPanel;
  if (!panel) return;
  if (panel.visible) return panel.hide();
  // A second press while the panel is still opening cancels that opening.
  if (opening) {
    opening.cancelled = true;
    return;
  }
  const attempt = { cancelled: false };
  opening = attempt;
  try {
    await openPanel(panel, attempt);
  } finally {
    if (opening === attempt) opening = null;
  }
}

/** The opening in progress, so a second press can cancel it. */
let opening: { cancelled: boolean } | null = null;

async function openPanel(
  panel: NonNullable<typeof ctx.quickPanel>,
  attempt: { cancelled: boolean },
): Promise<void> {
  const front = ctx.screenService?.supported
    ? await ctx.screenService.frontWindow().catch(() => null)
    : null;
  // Everything the chip shows is settled before the panel appears, so it never shows (or sends)
  // a window other than the one recorded here.
  const hint = front ? await screenHint().catch(() => "화면 정보를 확인하지 못했어.") : null;
  // Read while the other app still has focus; the panel taking focus would clear it.
  // Only once the user accepted the screen notice: like the screen, the selection is another
  // app's content that may go to the engine.
  const selected =
    ctx.screenService?.supported && ctx.database?.isScreenNoticeAccepted()
      ? await ctx.screenService.selectedText().catch(() => null)
      : null;
  frontWindowId = front && !hint ? front.id : null;
  selectedText = selected;
  if (attempt.cancelled) return;
  panel.setScreen(
    front ? { app: front.app, title: front.title } : null,
    hint,
    selected ? { preview: selectionPreview(selected), chars: selected.length } : null,
  );
  await panel.show();
}

/** Registers the quick panel's global shortcut; records whether another app already owns it. */
export function applyQuickShortcut(shortcut: QuickShortcut): void {
  if (registered) globalShortcut.unregister(registered);
  registered = null;
  ctx.quickShortcutOk = true;
  if (shortcut === "off") return;
  const ok = globalShortcut.register(shortcut, () => void toggleQuickPanel());
  ctx.quickShortcutOk = ok;
  if (ok) registered = shortcut;
}

/** The quick panel's only channels; each refuses any sender but the panel itself. */
export function registerQuickHandlers(): void {
  handleTaskStart(IPC_CHANNELS.quickAsk, async (event, raw: unknown) => {
    if (!isQuickPanel(event) || !ctx.quickPanel) throw new Error("Unknown sender asked Poko.");
    const request = (typeof raw === "object" && raw !== null ? raw : {}) as {
      question?: unknown;
      withScreen?: unknown;
      withSelection?: unknown;
      followUp?: unknown;
    };
    if (
      typeof request.question !== "string" ||
      !request.question.trim() ||
      request.question.length > 10_000
    )
      throw new TypeError("A non-empty question is required.");
    const question = request.question.trim();
    // Only the conversation main knows the panel is showing; the panel never names one. A
    // question with the screen starts fresh: a screen look carries no conversation history.
    const shown = request.followUp === true ? ctx.quickPanel.followUpConversation : null;
    // Not one the main window has since gone on with: the panel would continue unseen turns.
    const continued =
      shown && request.withScreen !== true && isLatestTurn(shown, ctx.quickPanel.taskId)
        ? shown
        : null;
    // Only the window main recorded when the panel opened, and only if the user included it.
    const windowId = request.withScreen === true ? frontWindowId : null;
    if (request.withScreen === true && windowId === null) {
      const message = "함께 볼 화면이 없어. 화면 없이 다시 물어봐 줘.";
      ctx.quickPanel.refuse(question, message, continued);
      return { error: message };
    }
    // The selection main read when the panel opened, as a text attachment: shown in the
    // conversation as 📎 선택한 글, and given to the engine as quoted, untrusted text.
    const selection =
      request.withSelection === true && windowId === null && selectedText
        ? [{ kind: "text" as const, name: "선택한 글", text: selectedText }]
        : [];
    let started: Awaited<ReturnType<typeof startConversationTask>>;
    let recorded: string | null = null;
    let recordedConversation: string | null = null;
    // While it starts, the conversation it continues can't be deleted (as for the main window).
    if (continued)
      startingConversations.set(continued, (startingConversations.get(continued) ?? 0) + 1);
    try {
      // The panel and the main window learn about the task before it starts: a task can end
      // right away, and its last event must find both ready.
      const onRecorded = ({
        taskId,
        conversation,
      }: {
        taskId: string;
        conversation: PersistedConversation;
      }) => {
        recorded = taskId;
        recordedConversation = conversation.id;
        ctx.quickPanel?.begin(question, taskId, conversation.id);
        const notice: TaskStartedNotice = { taskId, title: question, conversation };
        if (ctx.mainWindow && !ctx.mainWindow.isDestroyed())
          ctx.mainWindow.webContents.send(IPC_CHANNELS.taskStarted, notice);
      };
      // A question waits its turn while Poko is busy; a screen look needs the screen as it is now.
      started =
        windowId === null
          ? await startConversationTask(question, continued, onRecorded, selection, {
              allowQueue: true,
            })
          : await startScreenLook(windowId, question, continued, onRecorded);
    } catch (error) {
      // For example no folder selected: the message is already plain Korean.
      started = { error: error instanceof Error ? error.message : "작업을 시작하지 못했어." };
      // The main window was told about a task that never started: end it there too.
      if (recorded && ctx.mainWindow && !ctx.mainWindow.isDestroyed())
        ctx.mainWindow.webContents.send(IPC_CHANNELS.taskEvent, {
          taskId: recorded,
          event: { type: "error", error: "작업을 시작하지 못했어." },
        });
    }
    if (continued) {
      const left = (startingConversations.get(continued) ?? 1) - 1;
      if (left > 0) startingConversations.set(continued, left);
      else startingConversations.delete(continued);
    }
    if ("error" in started) {
      // A conversation that is gone (or whose folder is) isn't kept: the next try starts fresh.
      const gone = ("gone" in started && started.gone) || started.error === CONVERSATION_GONE;
      ctx.quickPanel.refuse(
        question,
        started.error,
        gone ? null : (recordedConversation ?? continued),
      );
      return { error: started.error };
    }
    if ("queued" in started)
      ctx.quickPanel.wait(question, started.queued.taskId, started.queued.conversationId);
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.quickCancel, (event) => {
    if (!isQuickPanel(event)) throw new Error("Unknown sender cancelled a question.");
    const taskId = ctx.quickPanel?.waitingTaskId;
    return taskId ? cancelQueued(taskId) : false;
  });

  // The panel can only say yes or no; the memory itself is the one main kept from the answer.
  ipcMain.handle(IPC_CHANNELS.quickRemember, async (event, keep: unknown) => {
    if (!isQuickPanel(event) || !ctx.quickPanel) throw new Error("Unknown sender answered.");
    const memory = ctx.quickPanel.pendingMemory;
    // Already answered (a second click): nothing to change.
    if (!memory) return false;
    if (keep !== true) {
      ctx.quickPanel.settleMemory("dropped");
      return false;
    }
    const panel = ctx.quickPanel;
    const taskId = panel.taskId;
    panel.savingMemory = true;
    try {
      if (!ctx.database) throw new Error("Local storage is unavailable.");
      const scope = await memoryFolder(memory.type, taskId ?? undefined);
      // Answered meanwhile (a second click, or a new question replaced the card).
      if (panel.pendingMemory !== memory) return false;
      if (typeof scope === "object" && scope !== null) throw new Error(scope.error);
      ctx.database.saveMemory({ type: memory.type, content: memory.content, importance: 3 }, scope);
    } catch (error) {
      console.error("Could not save a suggested memory.", error);
      ctx.quickPanel.settleMemory("failed");
      return false;
    } finally {
      panel.savingMemory = false;
    }
    ctx.quickPanel.settleMemory("saved");
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.quickFresh, (event) => {
    if (!isQuickPanel(event)) throw new Error("Unknown sender asked for a new question.");
    ctx.quickPanel?.startFresh();
    return true;
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
