import { describe, expect, it } from "vitest";
import { encodeRequestId, parseIncomingMessage } from "./appServerProtocol";

describe("parseIncomingMessage", () => {
  it("distinguishes responses, server requests, and notifications", () => {
    expect(parseIncomingMessage('{"id":1,"result":{"ok":true}}')).toEqual({
      type: "response",
      id: 1,
      result: { ok: true },
      error: undefined,
    });
    expect(parseIncomingMessage('{"id":2,"error":{"code":-1,"message":"nope"}}')).toMatchObject({
      type: "response",
      id: 2,
      error: { message: "nope" },
    });
    expect(
      parseIncomingMessage(
        '{"id":"a","method":"item/commandExecution/requestApproval","params":{"command":"ls"}}',
      ),
    ).toEqual({
      type: "request",
      id: "a",
      method: "item/commandExecution/requestApproval",
      params: { command: "ls" },
    });
    expect(parseIncomingMessage('{"method":"turn/started"}')).toEqual({
      type: "notification",
      method: "turn/started",
      params: {},
    });
  });

  it("rejects malformed messages", () => {
    for (const line of [
      "not json",
      "[]",
      '{"method":1}',
      '{"method":"x","params":[]}',
      '{"id":1.5,"method":"x"}',
      '{"id":{},"result":1}',
      '{"id":1}',
    ]) {
      expect(() => parseIncomingMessage(line), line).toThrow();
    }
  });

  it("keeps string and numeric request ids distinct", () => {
    expect(encodeRequestId(1)).not.toBe(encodeRequestId("1"));
  });
});
