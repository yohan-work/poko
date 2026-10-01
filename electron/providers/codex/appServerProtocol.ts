export type JsonRpcId = string | number;

export type IncomingMessage =
  | { type: "response"; id: JsonRpcId; result?: unknown; error?: { message?: string } }
  | { type: "request"; id: JsonRpcId; method: string; params: Record<string, unknown> }
  | { type: "notification"; method: string; params: Record<string, unknown> };

export function parseIncomingMessage(line: string): IncomingMessage {
  const value: unknown = JSON.parse(line);
  if (!isRecord(value)) throw new Error("Malformed App Server message.");

  if ("method" in value) {
    if (typeof value.method !== "string" || !value.method || !isRecord(value.params ?? {})) {
      throw new Error("Malformed App Server method message.");
    }
    const params = (value.params ?? {}) as Record<string, unknown>;
    if ("id" in value) {
      if (!isRequestId(value.id)) throw new Error("Malformed App Server request id.");
      return { type: "request", id: value.id, method: value.method, params };
    }
    return { type: "notification", method: value.method, params };
  }

  if (!isRequestId(value.id) || (!("result" in value) && !("error" in value))) {
    throw new Error("Malformed App Server response.");
  }
  const error = isRecord(value.error) ? { message: readString(value.error.message) } : undefined;
  return { type: "response", id: value.id, result: value.result, error };
}

export function encodeRequestId(id: JsonRpcId): string {
  return JSON.stringify(id);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRequestId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value));
}
