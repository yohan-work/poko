import type { AgentEvent } from "../shared";

const MAX_BODY = 120;

/** Markdown and whitespace reduced to one short plain line for a notification. */
export function plainLine(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[#>*\-+\s]+|[*_~]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > MAX_BODY ? `${plain.slice(0, MAX_BODY - 1)}…` : plain;
}

/**
 * What a task event says in a notification, or null when it isn't worth one. Only the end of
 * a task and a request for approval are; a cancel is the user's own doing.
 */
export function noticeFor(event: AgentEvent): { title: string; body: string } | null {
  switch (event.type) {
    case "completed":
      return { title: "포코가 답했어", body: plainLine(event.result) || "요청한 작업을 마쳤어." };
    case "error":
      return { title: "포코가 작업을 마치지 못했어", body: plainLine(event.error) };
    case "approvalRequired":
      return event.canApprove
        ? { title: "포코가 확인을 기다리고 있어", body: plainLine(event.summary) }
        : null;
    default:
      return null;
  }
}
