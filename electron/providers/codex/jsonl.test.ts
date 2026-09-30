import { describe, expect, it } from "vitest";
import { parseCodexJsonlLine } from "./jsonl";

describe("Codex JSONL event adapter", () => {
  it("normalizes task, tool, and assistant message records", () => {
    expect(parseCodexJsonlLine('{"type":"thread.started","thread_id":"thread-1"}')).toEqual([
      { type: "started" },
    ]);
    expect(parseCodexJsonlLine('{"type":"turn.started"}')).toEqual([{ type: "thinking" }]);
    expect(
      parseCodexJsonlLine(
        '{"type":"item.started","item":{"id":"cmd-1","type":"command_execution","command":"ls"}}',
      ),
    ).toEqual([{ type: "tool", tool: "terminal", detail: "프로젝트를 확인하고 있어." }]);
    expect(
      parseCodexJsonlLine(
        '{"type":"item.completed","item":{"id":"msg-1","type":"agent_message","text":"세 가지 개선점이 보여."}}',
      ),
    ).toEqual([{ type: "output", content: "세 가지 개선점이 보여." }]);
    expect(parseCodexJsonlLine('{"type":"turn.completed","usage":{"output_tokens":1}}')).toEqual([
      { type: "turn_completed" },
    ]);
  });

  it("ignores new additive event types and blank lines", () => {
    expect(parseCodexJsonlLine(" ")).toEqual([]);
    expect(parseCodexJsonlLine('{"type":"new.future.event","value":1}')).toEqual([]);
  });

  it("rejects malformed and structurally invalid records", () => {
    expect(() => parseCodexJsonlLine("not json")).toThrow("올바르지 않은 JSONL");
    expect(() => parseCodexJsonlLine("[]")).toThrow("이벤트 형식");
  });
});
