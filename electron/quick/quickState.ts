import { type AgentEvent, hideMemoryTag, type QuickState } from "../shared";

export const IDLE_STATE: QuickState = {
  phase: "idle",
  question: "",
  answer: "",
  message: null,
  conversationId: null,
  taskId: null,
  screen: null,
  screenHint: null,
  selection: null,
  opened: 0,
  memory: null,
};

/**
 * The panel's view of its task after one event. It keeps only what the panel shows: the answer
 * text, a short status, and whether the main window must handle an approval. Raw tool output
 * and approval details never reach the panel.
 */
export function reduceQuickState(
  state: QuickState,
  event: AgentEvent,
  itemId: { current: string | null; raw: string },
): QuickState {
  switch (event.type) {
    case "output": {
      // A new agent message replaces the previous one, as in the main window.
      const fresh = event.itemId !== undefined && event.itemId !== itemId.current;
      if (event.itemId !== undefined) itemId.current = event.itemId;
      // The raw text is kept apart, so a tag split across deltas is still recognized.
      itemId.raw = (fresh ? "" : itemId.raw) + event.content;
      return {
        ...state,
        phase: state.phase === "approval" ? "approval" : "running",
        answer: hideMemoryTag(itemId.raw),
        message: null,
      };
    }
    case "thinking":
      return { ...state, message: event.message ?? "요청을 살펴보고 있어." };
    case "tool":
      return { ...state, message: event.detail ?? "프로젝트를 살펴보고 있어." };
    case "approvalRequired":
      return event.canApprove
        ? { ...state, phase: "approval", message: "확인이 필요해. 앱에서 확인해 줘." }
        : state;
    case "completed":
      return {
        ...state,
        phase: "done",
        answer: event.result,
        message: null,
        memory: event.memory ?? null,
      };
    case "error":
      return { ...state, phase: "error", message: event.error };
    case "cancelled":
      return { ...state, phase: "error", message: "요청을 멈췄어." };
    default:
      return state;
  }
}
