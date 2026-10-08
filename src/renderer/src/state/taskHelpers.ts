import type { AgentEvent, AppBootstrap, CharacterState } from "../../../../electron/shared";
import type { ActivityEntry, AppState, ConversationMessage, SessionTask } from "./types";

export function createMessage(
  role: ConversationMessage["role"],
  content: string,
): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

export function activityText(event: AgentEvent): string | null {
  switch (event.type) {
    case "started":
      return "포코가 요청을 확인했어.";
    case "thinking":
      return event.message ?? "요청을 살펴보고 있어.";
    case "tool":
      return event.detail ?? "프로젝트를 살펴보고 있어.";
    case "completed":
      return "프로젝트 확인을 마쳤어.";
    case "cancelled":
      return "요청을 멈췄어.";
    case "error":
      return "작업을 마치지 못했어.";
    case "approvalRequired":
      return event.canApprove
        ? "포코가 다음 작업의 확인을 기다리고 있어."
        : "안전한 확인 정보가 없어 요청을 거절했어.";
    case "output":
      return null;
  }
}

export function eventCharacterState(event: AgentEvent): CharacterState {
  switch (event.type) {
    case "started":
    case "thinking":
      return "thinking";
    case "tool":
    case "output":
      return "working";
    case "completed":
      return "success";
    case "cancelled":
      return "idle";
    case "error":
      return "error";
    case "approvalRequired":
      return event.canApprove ? "approval" : "working";
  }
}

export function sessionTaskStatus(event: AgentEvent): SessionTask["status"] | null {
  if (event.type === "completed") return "completed";
  if (event.type === "error") return "failed";
  if (event.type === "cancelled") return "cancelled";
  return null;
}

/** Matches the number of activities loaded at startup. */
const MAX_ACTIVITIES = 500;

export function addActivity(state: AppState, taskId: string, message: string): ActivityEntry[] {
  return [
    ...state.activities,
    {
      id: crypto.randomUUID(),
      taskId,
      taskTitle: state.tasks.find((task) => task.id === taskId)?.title,
      message,
      createdAt: new Date().toISOString(),
    },
  ].slice(-MAX_ACTIVITIES);
}

/** The store's view of the data main starts from. */
export function fromBootstrap(data: AppBootstrap): Partial<AppState> {
  return {
    workspace: data.workspace,
    conversations: data.conversations,
    activeConversationId: data.conversationId,
    messages: data.messages,
    tasks: data.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      // Startup recovery already closed interrupted tasks; anything else is treated as running.
      status: task.status === "queued" ? "running" : task.status,
      createdAt: task.createdAt,
      completedAt: task.completedAt ?? undefined,
    })),
    // Storage returns newest first; the store appends new entries, so keep it oldest first.
    activities: [...data.activities].reverse(),
  };
}

/**
 * The question as the user typed it, or null when it can't be sent again as it was: a message
 * with files (📎) or a screen task (🖥️, 🖱️), whose content or window isn't kept.
 */
export function questionText(content: string): string | null {
  if (/^(🖥️|🖱️)/u.test(content) || /(^|\n)📎 /u.test(content)) return null;
  return content.trim() || null;
}
