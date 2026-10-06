import type { AgentEvent, TaskEventPayload } from "./shared";

/** Shape checks for task events from main, so the renderer only ever sees well-formed ones. */
export function isTaskEventPayload(value: unknown): value is TaskEventPayload {
  if (typeof value !== "object" || value === null || !("taskId" in value) || !("event" in value)) {
    return false;
  }
  const payload = value as { taskId: unknown; event: unknown };
  if (
    typeof payload.taskId !== "string" ||
    typeof payload.event !== "object" ||
    payload.event === null
  ) {
    return false;
  }

  const event = payload.event as Record<string, unknown>;
  switch (event.type) {
    case "started":
    case "cancelled":
      return true;
    case "thinking":
      return event.message === undefined || typeof event.message === "string";
    case "tool":
      return (
        typeof event.tool === "string" &&
        (event.detail === undefined || typeof event.detail === "string")
      );
    case "output":
      return (
        typeof event.content === "string" &&
        (event.itemId === undefined || typeof event.itemId === "string")
      );
    case "completed":
      return (
        typeof event.result === "string" &&
        (event.memory === undefined ||
          (typeof event.memory === "object" &&
            event.memory !== null &&
            typeof (event.memory as { content?: unknown }).content === "string" &&
            typeof (event.memory as { type?: unknown }).type === "string"))
      );
    case "error":
      return typeof event.error === "string";
    case "approvalRequired":
      return (
        typeof event.requestId === "string" &&
        (event.kind === "command" ||
          event.kind === "file_change" ||
          event.kind === "screen_action") &&
        typeof event.summary === "string" &&
        (event.cwd === null || typeof event.cwd === "string") &&
        (event.reason === null || typeof event.reason === "string") &&
        typeof event.canApprove === "boolean" &&
        (event.diff === undefined ||
          (Array.isArray(event.diff) &&
            event.diff.every(
              (entry: unknown) =>
                typeof entry === "object" &&
                entry !== null &&
                typeof (entry as { path?: unknown }).path === "string" &&
                typeof (entry as { change?: unknown }).change === "string",
            ))) &&
        (event.screen === undefined || isScreenPreview(event.screen)) &&
        // A screen step is approved only on the card, so it must carry its crop.
        (event.kind !== "screen_action" || event.screen !== undefined)
      );
    default:
      return false;
  }
}

/** A screen step's card data: the crop is the evidence, so it must be a PNG image. */
function isScreenPreview(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const preview = value as Record<string, unknown>;
  return (
    (preview.action === "click" || preview.action === "type" || preview.action === "reveal") &&
    typeof preview.crop === "string" &&
    preview.crop.startsWith("data:image/png;base64,") &&
    typeof preview.target === "string" &&
    (preview.text === undefined || typeof preview.text === "string") &&
    (preview.warning === undefined || typeof preview.warning === "string")
  );
}

export function isAgentEvent(value: unknown): value is AgentEvent {
  return typeof value === "object" && value !== null && "type" in value;
}
