import { ipcMain } from "electron";
import { IPC_CHANNELS, type ApprovalChoice, type ApprovalOutcome } from "../shared";
import { resolveWorkspaceDirectory } from "../agent/workspace";
import {
  ctx,
  CONVERSATION_GONE,
  handleTaskStart,
  isTrustedRenderer,
  readConversationId,
  recordTaskStart,
  settleEdits,
  startingConversations,
} from "./context";

/** Approval answers in progress, so a double click can't checkpoint or answer twice. */
const answering = new Set<string>();

/** Tasks, approvals, and conversations. */
export function registerTaskHandlers(): void {
  handleTaskStart(IPC_CHANNELS.taskStart, async (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.agentCore) {
      throw new Error("Unknown renderer requested a task.");
    }
    const request = (typeof raw === "object" && raw !== null ? raw : {}) as {
      message?: unknown;
      conversationId?: unknown;
    };
    const rawMessage = request.message;
    const conversationId = readConversationId(request.conversationId);
    if (typeof rawMessage !== "string" || rawMessage.trim().length === 0) {
      throw new TypeError("A non-empty message is required.");
    }
    if (rawMessage.length > 10_000) {
      throw new TypeError("The request is too long.");
    }

    if (ctx.screenRun) throw new Error("Poko is busy with a screen task.");
    const workspacePath = ctx.database?.getWorkspace() ?? null;
    const cwd = await resolveWorkspaceDirectory(workspacePath);
    // A screen task may have started while the folder was being checked.
    if (ctx.screenRun) throw new Error("Poko is busy with a screen task.");
    if (!ctx.database) throw new Error("Local storage is unavailable.");
    const started = recordTaskStart(ctx.database, rawMessage.trim(), cwd, conversationId);
    if ("error" in started) return started;
    const { taskId } = started;
    try {
      const context = ctx.database?.getTaskContext(taskId);
      ctx.agentCore.startTask({
        prompt: rawMessage.trim(),
        cwd,
        taskId,
        context,
        editsEnabled: ctx.database.isEditsEnabled(cwd),
      });
    } catch (error) {
      ctx.database?.recordTaskEvent(
        taskId,
        "error",
        "작업을 시작하지 못했어.",
        "작업을 시작하지 못했어.",
      );
      throw error;
    }
    return started;
  });

  ipcMain.handle(IPC_CHANNELS.conversationOpen, (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.database || !ctx.agentCore)
      throw new Error("Unknown renderer requested a conversation.");
    const id = readConversationId(raw);
    // A running task's messages, stream, and approval card belong to its conversation.
    if (ctx.agentCore.hasActiveTasks || ctx.screenRun)
      return { error: "포코가 작업 중이라 다른 대화로 옮길 수 없어. 끝난 뒤에 다시 골라 줘." };
    if (id !== null && !ctx.database.getConversation(id)) return { error: CONVERSATION_GONE };
    ctx.database.setActiveConversation(id);
    return { messages: id === null ? [] : ctx.database.getConversationMessages(id) };
  });

  ipcMain.handle(IPC_CHANNELS.conversationRename, (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer renamed a conversation.");
    const request = (typeof raw === "object" && raw !== null ? raw : {}) as {
      conversationId?: unknown;
      title?: unknown;
    };
    const id = readConversationId(request.conversationId);
    if (id === null || typeof request.title !== "string" || request.title.length > 400)
      throw new TypeError("Invalid rename request.");
    const title = request.title.replace(/\s+/g, " ").trim();
    if (!title) return { error: "제목을 적어 줘." };
    if (Array.from(title).length > 80) return { error: "제목은 80자까지 쓸 수 있어." };
    return ctx.database.renameConversation(id, title) ? { ok: true } : { error: CONVERSATION_GONE };
  });

  ipcMain.handle(IPC_CHANNELS.conversationDelete, async (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer deleted a conversation.");
    const id = readConversationId(raw);
    if (id === null) throw new TypeError("Invalid conversation id.");
    // A running task's reply and approval card belong to its conversation, and a task that is
    // still starting (capturing the screen, checking the folder) is about to be recorded there.
    if (ctx.database.hasRunningTask(id) || (startingConversations.get(id) ?? 0) > 0)
      return { error: "포코가 이 대화에서 작업 중이라 지금은 지울 수 없어." };
    await ctx.editManager?.forgetConversation(id);
    return ctx.database.deleteConversation(id) ? { ok: true } : { error: CONVERSATION_GONE };
  });

  ipcMain.handle(IPC_CHANNELS.taskCancel, (event, rawTaskId: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.agentCore) {
      throw new Error("Unknown renderer requested task cancellation.");
    }
    if (typeof rawTaskId !== "string" || rawTaskId.length > 100) {
      throw new TypeError("A valid task id is required.");
    }
    if (ctx.screenRun?.taskId === rawTaskId) {
      ctx.screenRun.agent.stop();
      return true;
    }
    return ctx.agentCore.cancelTask(rawTaskId);
  });

  ipcMain.handle(IPC_CHANNELS.approvalRespond, async (event, rawRequest: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.database || !ctx.agentCore)
      throw new Error("Unknown renderer requested an approval decision.");
    if (typeof rawRequest !== "object" || rawRequest === null)
      throw new TypeError("Invalid approval response.");
    const request = rawRequest as { taskId?: unknown; requestId?: unknown; choice?: unknown };
    if (
      typeof request.taskId !== "string" ||
      typeof request.requestId !== "string" ||
      request.taskId.length > 100 ||
      request.requestId.length > 200 ||
      (request.choice !== "approve" && request.choice !== "decline")
    )
      throw new TypeError("Invalid approval response.");
    if (ctx.screenRun?.taskId === request.taskId) {
      const { agent } = ctx.screenRun;
      if (!agent.hasPending(request.requestId)) return "stale";
      const choice = request.choice as ApprovalChoice;
      if (!ctx.database.resolveApproval(request.taskId, request.requestId, choice)) return "stale";
      return agent.respond(request.requestId, choice) ? "applied" : "stale";
    }
    if (!ctx.agentCore.hasPendingApproval(request.taskId, request.requestId)) return "stale";
    const key = `${request.taskId}:${request.requestId}`;
    if (answering.has(key)) return "stale";
    answering.add(key);
    try {
      return await answerApproval(
        request.taskId,
        request.requestId,
        request.choice as ApprovalChoice,
      );
    } finally {
      answering.delete(key);
    }
  });

  /** Decides, checkpoints an approved file change, records, and answers Codex. */
  async function answerApproval(
    taskId: string,
    requestId: string,
    requested: ApprovalChoice,
  ): Promise<ApprovalOutcome> {
    if (!ctx.database || !ctx.agentCore) return "stale";
    const request = { taskId, requestId, choice: requested };
    // Decide before recording, so the audit row always matches what Codex receives. A file change
    // also needs edits still on for its workspace: turning them off withdraws earlier cards.
    const workspace = ctx.database.getTaskWorkspace(request.taskId);
    const fileChange =
      ctx.database.getApprovalKind(request.taskId, request.requestId) === "file_change";
    const editsWithdrawn = fileChange && !(workspace && ctx.database.isEditsEnabled(workspace));
    const unsafe =
      request.choice === "approve" &&
      (editsWithdrawn || !ctx.agentCore.canStillApprove(request.taskId, request.requestId));
    let declineInstead = unsafe;
    if (!unsafe && request.choice === "approve" && workspace && fileChange) {
      // The change Codex made before this one is on disk by now; settle it first so each
      // edit's "after" state is its own. Then save the files this change will touch.
      try {
        await settleEdits(request.taskId);
        const paths = ctx.agentCore.fileChangePaths(request.taskId, request.requestId);
        if (!paths || !ctx.editManager) throw new Error("No file change to checkpoint.");
        await ctx.editManager.checkpoint(request.taskId, request.requestId, workspace, paths);
      } catch (error) {
        console.error("Could not checkpoint a file change; declining it.", error);
        declineInstead = true;
      }
    }
    const choice: ApprovalChoice = declineInstead ? "decline" : request.choice;
    if (!ctx.database.resolveApproval(request.taskId, request.requestId, choice)) return "stale";
    if (!ctx.agentCore.respondToApproval(request.taskId, request.requestId, choice)) {
      console.error("The decision was recorded but could not be sent to Codex.");
      return "stale";
    }
    return declineInstead ? "declined_unsafe" : "applied";
  }
}
