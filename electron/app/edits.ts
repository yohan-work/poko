import { ipcMain } from "electron";
import { resolveWorkspaceDirectory } from "../agent/workspace";
import { IPC_CHANNELS } from "../shared";
import { ctx, isTrustedRenderer, notifyEditsChanged, readConversationId } from "./context";

/** The edit switch, approved changes, and undo. */
export function registerEditsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.editsGet, async (event) => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer asked for edits.");
    const workspacePath = ctx.database.getWorkspace();
    if (!workspacePath) return { available: false, enabled: false };
    const realPath = await resolveWorkspaceDirectory(workspacePath);
    return { available: true, enabled: ctx.database.isEditsEnabled(realPath) };
  });

  ipcMain.handle(IPC_CHANNELS.editsSet, async (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.database || !ctx.agentCore)
      throw new Error("Unknown renderer changed edits.");
    if (typeof raw !== "boolean") throw new TypeError("Invalid edits setting.");
    const workspacePath = ctx.database.getWorkspace();
    if (!workspacePath) return { error: "먼저 작업할 폴더를 선택해 줘." };
    const realPath = await resolveWorkspaceDirectory(workspacePath);
    ctx.database.setEditsEnabled(realPath, raw);
    const declined: Array<{ taskId: string; requestId: string }> = [];
    if (!raw) {
      // A change shown before edits were turned off must not apply afterwards. Only this
      // folder's changes are withdrawn; the renderer removes exactly these cards.
      for (const pending of ctx.database.pendingFileChanges(realPath)) {
        if (ctx.database.resolveApproval(pending.taskId, pending.requestId, "decline")) {
          ctx.agentCore.respondToApproval(pending.taskId, pending.requestId, "decline");
          declined.push(pending);
        }
      }
    }
    return { available: true, enabled: raw, declined };
  });

  ipcMain.handle(IPC_CHANNELS.editsList, (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.editManager)
      throw new Error("Unknown renderer asked for edits.");
    const id = readConversationId(raw);
    return id === null ? [] : ctx.editManager.notes(id);
  });

  ipcMain.handle(IPC_CHANNELS.editsUndo, async (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.database || !ctx.agentCore || !ctx.editManager)
      throw new Error("Unknown renderer asked to undo.");
    if (typeof raw !== "string" || raw.length > 100) throw new TypeError("Invalid edit id.");
    // Codex may be changing the same files right now.
    if (ctx.agentCore.hasActiveTasks || ctx.screenRun)
      return { error: "포코가 작업 중이라 끝난 뒤에 되돌릴 수 있어." };
    const edit = ctx.database.getEdit(raw);
    const failure = await ctx.editManager.undo(raw);
    if (failure) return { error: failure };
    if (edit?.conversationId) notifyEditsChanged(edit.conversationId);
    return { ok: true };
  });
}
