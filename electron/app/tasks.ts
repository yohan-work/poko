import { ipcMain } from "electron";
import {
  type ActiveTaskInfo,
  IPC_CHANNELS,
  type ApprovalChoice,
  type ApprovalOutcome,
} from "../shared";
import { checkAttachments } from "../attachments/attachments";
import {
  ctx,
  CONVERSATION_GONE,
  handleTaskStart,
  isTrustedRenderer,
  pendingApprovalEvents,
  readConversationId,
  settleEdits,
  startConversationTask,
  startingConversations,
} from "./context";
import { markRoutineStopped, routineTitleFor } from "./routines";
import { cancelQueued, waitingQuestions } from "./queue";

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
      attachments?: unknown;
    };
    const rawMessage = request.message;
    const conversationId = readConversationId(request.conversationId);
    const attachments = checkAttachments(request.attachments);
    if ("error" in attachments) return attachments;
    if (
      typeof rawMessage !== "string" ||
      (rawMessage.trim().length === 0 && attachments.length === 0)
    ) {
      throw new TypeError("A message or an attachment is required.");
    }
    if (rawMessage.length > 10_000) {
      throw new TypeError("The request is too long.");
    }

    // Only the main window queues a question while Poko is busy (Phase 17).
    return startConversationTask(rawMessage.trim(), conversationId, undefined, attachments, {
      allowQueue: true,
    });
  });

  ipcMain.handle(IPC_CHANNELS.taskQueued, (event) => {
    if (!isTrustedRenderer(event)) throw new Error("Unknown renderer requested the queue.");
    return waitingQuestions();
  });

  ipcMain.handle(IPC_CHANNELS.taskCancelQueued, (event, rawTaskId: unknown) => {
    if (!isTrustedRenderer(event)) throw new Error("Unknown renderer cancelled a question.");
    if (typeof rawTaskId !== "string" || rawTaskId.length > 100)
      throw new TypeError("A valid task id is required.");
    return cancelQueued(rawTaskId);
  });

  ipcMain.handle(IPC_CHANNELS.conversationOpen, (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.database || !ctx.agentCore)
      throw new Error("Unknown renderer requested a conversation.");
    const id = readConversationId(raw);
    // A running task's messages, stream, and approval card belong to its conversation, so only
    // that conversation may be opened while it runs (the window adopts the task there).
    const running = ctx.agentCore.activeTaskIds[0];
    const runningConversation = running ? ctx.database.getTaskConversation(running)?.id : null;
    if ((ctx.agentCore.hasActiveTasks && id !== runningConversation) || ctx.screenRun)
      return { error: "포코가 작업 중이라 다른 대화로 옮길 수 없어. 끝난 뒤에 다시 골라 줘." };
    if (id !== null && !ctx.database.getConversation(id)) return { error: CONVERSATION_GONE };
    ctx.database.setActiveConversation(id);
    return { messages: id === null ? [] : ctx.database.getConversationMessages(id) };
  });

  ipcMain.handle(IPC_CHANNELS.taskActive, (event): ActiveTaskInfo | null => {
    if (!isTrustedRenderer(event) || !ctx.database || !ctx.agentCore)
      throw new Error("Unknown renderer requested the active task.");
    const taskId = ctx.agentCore.activeTaskIds[0];
    if (!taskId) return null;
    return {
      taskId,
      conversationId: ctx.database.getTaskConversation(taskId)?.id ?? null,
      approvals: [...(pendingApprovalEvents.get(taskId)?.values() ?? [])],
      answer: ctx.quickPanel?.answerFor(taskId),
      routineTitle: routineTitleFor(taskId),
    };
  });

  ipcMain.handle(IPC_CHANNELS.conversationSearch, (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer searched conversations.");
    if (typeof raw !== "string" || raw.length > 200) throw new TypeError("Invalid search.");
    return ctx.database.searchConversations(raw);
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
    // A routine run stopped from a window that took it over is skipped, not failed.
    markRoutineStopped(rawTaskId, "멈췄어.");
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
    const kind = ctx.database.getApprovalKind(request.taskId, request.requestId);
    const fileChange = kind === "file_change";
    // Commands, like file changes, are offered only while edits stay on for the workspace.
    const needsEdits = fileChange || kind === "command";
    const editsWithdrawn = needsEdits && !(workspace && ctx.database.isEditsEnabled(workspace));
    // Leftover processes from earlier commands are stopped before the safety re-check.
    if (request.choice === "approve" && !editsWithdrawn)
      await ctx.agentCore
        .prepareApproval(request.taskId, request.requestId)
        .catch((error) => console.error("Could not prepare an approval.", error));
    const unsafe =
      request.choice === "approve" &&
      (editsWithdrawn || !ctx.agentCore.canStillApprove(request.taskId, request.requestId));
    let declineInstead = unsafe;
    if (!unsafe && request.choice === "approve" && kind === "command") {
      // Record earlier edits' "after" state now, so a command that rewrites those files later
      // makes their undo refuse as changed instead of erasing the command's work.
      await settleEdits(request.taskId).catch((error) =>
        console.error("Could not settle edits before a command.", error),
      );
    }
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
    pendingApprovalEvents.get(request.taskId)?.delete(request.requestId);
    if (!pendingApprovalEvents.get(request.taskId)?.size) ctx.quickPanel?.resume(request.taskId);
    if (!ctx.database.resolveApproval(request.taskId, request.requestId, choice)) return "stale";
    if (!ctx.agentCore.respondToApproval(request.taskId, request.requestId, choice)) {
      console.error("The decision was recorded but could not be sent to Codex.");
      return "stale";
    }
    return declineInstead ? "declined_unsafe" : "applied";
  }
}
