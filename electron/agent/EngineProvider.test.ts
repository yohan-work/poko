import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentTask, EngineId } from "../shared";
import type { AgentProvider } from "./AgentProvider";
import { EngineProvider } from "./EngineProvider";

function fake(name: string): AgentProvider & { answered: string[] } {
  const answered: string[] = [];
  return {
    answered,
    async *runTask(): AsyncIterable<AgentEvent> {
      yield { type: "output", content: name };
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "completed", result: name };
    },
    respondToApproval: (taskId) => {
      answered.push(taskId);
      return true;
    },
  };
}

const task = (id: string): AgentTask => ({ id, prompt: "", cwd: "/w", mode: "read" });

describe("EngineProvider", () => {
  it("runs each task on the engine chosen at its start and answers through it", async () => {
    const codex = fake("codex");
    const claude = fake("claude");
    let engine: EngineId = "codex";
    const provider = new EngineProvider({ codex, claude }, () => engine);

    const first = provider.runTask(task("a"))[Symbol.asyncIterator]();
    expect((await first.next()).value).toEqual({ type: "output", content: "codex" });
    engine = "claude"; // a change mid-task applies to the next task only
    expect(provider.respondToApproval("a", "1", "approve")).toBe(true);
    expect(codex.answered).toEqual(["a"]);
    expect((await first.next()).value).toEqual({ type: "completed", result: "codex" });
    await first.next();
    expect(provider.respondToApproval("a", "1", "approve")).toBe(false);

    const events: AgentEvent[] = [];
    for await (const event of provider.runTask(task("b"))) events.push(event);
    expect(events.at(-1)).toEqual({ type: "completed", result: "claude" });
  });
});
