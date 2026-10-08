import { removeAttachments } from "../attachments/attachments";
import { replaceCitations } from "../screen/overlayScene";
import { type ApprovalRequest, IPC_CHANNELS, isSameMemory, type TaskEventPayload } from "../shared";
import { attachmentDirs, ctx, pendingApprovalEvents, settleEdits } from "./context";
import { notifyTaskEvent } from "./notify";
import { noteTaskEnded } from "./queue";
import { recordRoutineEnd } from "./routines";
import { pointAt, screenTasks } from "./screen";
import { suggestionFolder } from "./workspace";

/** Records a task event and sends it on, for Codex tasks and screen tasks alike. */
export function deliverTaskEvent(incoming: TaskEventPayload): void {
  let payload = incoming;
  const screenTask = screenTasks.get(payload.taskId);
  if (screenTask && ["completed", "error", "cancelled"].includes(payload.event.type)) {
    // A finished screen task's screenshot and work folder are removed right away.
    screenTasks.delete(payload.taskId);
    void ctx.screenService?.cleanup(screenTask.tempDir);
    if (payload.event.type === "completed") {
      const { snapshot } = screenTask;
      const answer = payload.event.result;
      // Poko flies to what it talked about, and the chat names it instead of `[12]`.
      void pointAt(snapshot, answer);
      payload = {
        ...payload,
        event: { ...payload.event, result: replaceCitations(answer, snapshot) },
      };
    }
  }
  // A suggestion matching a saved memory isn't worth asking about again.
  if (payload.event.type === "completed" && payload.event.memory && ctx.database) {
    const { memory: suggested } = payload.event;
    let known = false;
    try {
      const folder = suggestionFolder(suggested.type, payload.taskId);
      const wanted = { ...suggested, workspacePath: folder === "gone" ? null : folder };
      known = ctx.database.listMemories().some((memory) => isSameMemory(memory, wanted));
    } catch (error) {
      // Only the duplicate check is lost; the task still finishes normally.
      console.error("Could not check saved memories.", error);
    }
    if (known) {
      const { memory: _known, ...rest } = payload.event;
      payload = { ...payload, event: rest };
    }
  }
  const event = payload.event;
  const finished =
    event.type === "completed" || event.type === "error" || event.type === "cancelled";
  // When a task finishes, its last approved change is on disk (or never happened).
  if (finished) {
    recordRoutineEnd(payload.taskId, event.type, event.type === "error" ? event.error : undefined);
    void settleEdits(payload.taskId);
    // The next waiting question starts once Poko is idle, after these edits settle.
    noteTaskEnded(payload.taskId);
    // Attached images are needed only while the task runs.
    const attached = attachmentDirs.get(payload.taskId);
    attachmentDirs.delete(payload.taskId);
    if (attached) void removeAttachments(attached);
    pendingApprovalEvents.delete(payload.taskId);
  }
  // The quick panel follows only its own task, in a reduced form.
  if (ctx.quickPanel && ctx.quickPanel.taskId === payload.taskId) ctx.quickPanel.update(event);
  let rendererPayload = payload;
  if (event.type === "approvalRequired") {
    const request: ApprovalRequest = { taskId: payload.taskId, ...event };
    try {
      ctx.database?.recordApprovalRequest(request);
    } catch (error) {
      console.error("Could not persist approval request.", error);
      if (ctx.screenRun?.taskId === payload.taskId)
        ctx.screenRun.agent.respond(event.requestId, "decline");
      else ctx.agentCore?.respondToApproval(payload.taskId, event.requestId, "decline");
      rendererPayload = {
        ...payload,
        event: { ...event, canApprove: false, reason: "승인 요청을 저장하지 못했어." },
      };
    }
  }
  const activityMessage =
    event.type === "output"
      ? null
      : event.type === "thinking"
        ? (event.message ?? "요청을 살펴보고 있어.")
        : event.type === "tool"
          ? (event.detail ?? "프로젝트를 살펴보고 있어.")
          : event.type === "started"
            ? "포코가 요청을 확인했어."
            : event.type === "completed"
              ? "프로젝트 확인을 마쳤어."
              : event.type === "approvalRequired"
                ? event.canApprove
                  ? "포코가 다음 작업의 확인을 기다리고 있어."
                  : "안전한 확인 정보가 없어 요청을 거절했어."
                : event.type === "cancelled"
                  ? "요청을 멈췄어."
                  : "작업을 마치지 못했어.";
  const result =
    event.type === "completed"
      ? event.result
      : event.type === "error"
        ? event.error
        : event.type === "cancelled"
          ? "요청을 멈췄어."
          : undefined;
  try {
    if (event.type !== "approvalRequired") {
      ctx.database?.recordTaskEvent(payload.taskId, event.type, activityMessage, result);
    }
  } catch (error) {
    console.error("Could not persist task event.", error);
  }
  // Kept for a main window that opens while the card waits (see task:active).
  const shown = rendererPayload.event;
  if (shown.type === "approvalRequired" && shown.canApprove) {
    const cards = pendingApprovalEvents.get(payload.taskId) ?? new Map();
    cards.set(shown.requestId, { taskId: payload.taskId, ...shown });
    pendingApprovalEvents.set(payload.taskId, cards);
  }
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed() && !ctx.mainWindow.webContents.isDestroyed())
    ctx.mainWindow.webContents.send(IPC_CHANNELS.taskEvent, rendererPayload);
  // A notification is extra: it comes after the window has the event and never stops it.
  try {
    notifyTaskEvent(rendererPayload);
  } catch (error) {
    console.error("Could not show a task notification.", error);
  }
}
