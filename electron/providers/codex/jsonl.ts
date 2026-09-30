export type CodexRecord =
  | { type: "started" }
  | { type: "thinking" }
  | { type: "tool"; tool: string; detail: string }
  | { type: "output"; content: string }
  | { type: "turn_completed" }
  | { type: "turn_failed"; message: string }
  | { type: "error"; message: string };

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getMessage(value: unknown): string {
  if (typeof value === "string") return value;
  const object = asObject(value);
  return typeof object?.message === "string" ? object.message : "Codex 작업이 실패했어.";
}

export function parseCodexJsonlLine(line: string): CodexRecord[] {
  if (!line.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error("Codex가 올바르지 않은 JSONL 이벤트를 보냈어.");
  }

  const event = asObject(parsed);
  if (!event || typeof event.type !== "string") {
    throw new Error("Codex 이벤트 형식을 읽을 수 없어.");
  }

  switch (event.type) {
    case "thread.started":
      return [{ type: "started" }];
    case "turn.started":
      return [{ type: "thinking" }];
    case "turn.completed":
      return [{ type: "turn_completed" }];
    case "turn.failed":
      return [{ type: "turn_failed", message: getMessage(event.error) }];
    case "error":
      return [{ type: "error", message: getMessage(event) }];
    case "item.started":
    case "item.updated": {
      const item = asObject(event.item);
      if (item?.type === "reasoning") return [{ type: "thinking" }];
      if (item?.type === "command_execution") {
        return [{ type: "tool", tool: "terminal", detail: "프로젝트를 확인하고 있어." }];
      }
      if (item?.type === "file_change") {
        return [{ type: "tool", tool: "file", detail: "파일 상태를 살펴보고 있어." }];
      }
      if (item?.type === "mcp_tool_call") {
        return [{ type: "tool", tool: "tool", detail: "작업 도구를 사용하고 있어." }];
      }
      return [];
    }
    case "item.completed": {
      const item = asObject(event.item);
      if (item?.type === "agent_message" && typeof item.text === "string") {
        return [{ type: "output", content: item.text }];
      }
      if (item?.type === "command_execution") {
        return [{ type: "tool", tool: "terminal", detail: "프로젝트 확인을 마쳤어." }];
      }
      return [];
    }
    default:
      // Codex may add event types over time. Ignore unknown additive events.
      return [];
  }
}
