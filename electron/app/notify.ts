import { BrowserWindow, Notification } from "electron";
import { noticeFor } from "../notify/taskNotice";
import { IPC_CHANNELS, type TaskEventPayload } from "../shared";
import { ctx } from "./context";

/** Shown notifications, kept so their click handlers live; at most a few at a time. */
const shown = new Set<Notification>();

/**
 * Tells the user, with a macOS notification, that a task ended or waits for approval, but
 * only while no Poko window is in front (they're looking elsewhere). A click opens the task's
 * conversation in the main window.
 */
export function notifyTaskEvent(payload: TaskEventPayload): void {
  if (!ctx.database?.getSettings().taskNotifications) return;
  const notice = noticeFor(payload.event);
  if (!notice || !Notification.isSupported()) return;
  // A focused Poko window (main or the quick panel) already shows this.
  if (BrowserWindow.getFocusedWindow()) return;
  const conversationId = ctx.database.getTaskConversation(payload.taskId)?.id ?? null;
  const notification = new Notification({ title: notice.title, body: notice.body, silent: false });
  shown.add(notification);
  const forget = () => shown.delete(notification);
  notification.on("close", forget);
  notification.on("click", () => {
    forget();
    void (async () => {
      await ctx.openMainWindow?.();
      if (conversationId && ctx.mainWindow && !ctx.mainWindow.isDestroyed())
        ctx.mainWindow.webContents.send(IPC_CHANNELS.appFocusConversation, conversationId);
    })();
  });
  notification.show();
  // Old ones go first, so a long session doesn't keep every notification alive.
  if (shown.size > 5) {
    const oldest = shown.values().next().value;
    if (oldest) shown.delete(oldest);
  }
}
