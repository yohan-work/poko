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

  it("runs screen tasks on the chosen engine", async () => {
    const provider = new EngineProvider(
      { codex: fake("codex"), claude: fake("claude") },
      () => "claude",
    );
    const events: AgentEvent[] = [];
    for await (const event of provider.runTask({ ...task("s"), profile: "screen" }))
      events.push(event);
    expect(events.at(-1)).toEqual({ type: "completed", result: "claude" });
  });

  it("passes the engine's picked model, but never to screen tasks", async () => {
    const seen: Array<string | undefined> = [];
    const recorder: AgentProvider = {
      async *runTask(input) {
        seen.push(`${input.model}/${input.effort}`);
        yield { type: "completed", result: "" };
      },
    };
    const provider = new EngineProvider(
      { codex: recorder, claude: recorder },
      () => "claude",
      (engine) => (engine === "claude" ? "opus" : "gpt-6-astra"),
      () => "high",
    );
    for await (const _ of provider.runTask(task("a"))) void _;
    for await (const _ of provider.runTask({ ...task("s"), profile: "screen" })) void _;
    expect(seen).toEqual(["opus/high", "undefined/undefined"]);
  });

  it("keeps a task on the engine it was pinned to", async () => {
    let engine: EngineId = "claude";
    const provider = new EngineProvider(
      { codex: fake("codex"), claude: fake("claude") },
      () => engine,
    );
    const run = provider.runTask({ ...task("p"), profile: "screen", engine: "codex" });
    engine = "claude";
    const events: AgentEvent[] = [];
    for await (const event of run) events.push(event);
    expect(events.at(-1)).toEqual({ type: "completed", result: "codex" });
  });
});
