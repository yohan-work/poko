import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentTask } from "../shared";
import type { AgentProvider } from "./AgentProvider";
import { AgentCore } from "./AgentCore";

class FakeProvider implements AgentProvider {
  async *runTask(
    input: AgentTask,
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<AgentEvent> {
    yield { type: "started" };
    if (options.signal?.aborted) {
      yield { type: "cancelled" };
      return;
    }
    yield { type: "completed", result: `Analyzed ${input.cwd}` };
  }
}

describe("AgentCore", () => {
  it("creates task ids and forwards provider events without exposing a cwd input to IPC", async () => {
    const publish = vi.fn();
    const core = new AgentCore(new FakeProvider(), publish, "Inspect before suggesting.");
    const taskId = core.startTask({ prompt: "analyze this project", cwd: "/selected/workspace" });

    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(2));

    expect(publish).toHaveBeenNthCalledWith(1, {
      taskId,
      event: { type: "started" },
    });
    expect(publish).toHaveBeenNthCalledWith(2, {
      taskId,
      event: { type: "completed", result: "Analyzed /selected/workspace" },
    });
  });

  it("allows only one active task and can cancel it", async () => {
    const publish = vi.fn();
    const provider: AgentProvider = {
      async *runTask(_input, options = {}) {
        yield { type: "started" };
        await new Promise<void>((resolve) => {
          if (options.signal?.aborted) resolve();
          else options.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        yield { type: "cancelled" };
      },
    };
    const core = new AgentCore(provider, publish);
    const taskId = core.startTask({ prompt: "inspect", cwd: "/workspace" });

    expect(() => core.startTask({ prompt: "another task", cwd: "/workspace" })).toThrow(
      "이미 다른 작업",
    );
    expect(core.cancelTask(taskId)).toBe(true);
    await vi.waitFor(() =>
      expect(publish).toHaveBeenCalledWith({ taskId, event: { type: "cancelled" } }),
    );
    expect(core.cancelTask("unknown")).toBe(false);
  });

  it("places saved memories and recent conversation between the guidance and the request", async () => {
    let prompt = "";
    const provider: AgentProvider = {
      async *runTask(input) {
        prompt = input.prompt;
        yield { type: "completed", result: "done" };
      },
    };
    const core = new AgentCore(provider, vi.fn(), "Inspect before suggesting.");
    core.startTask({
      prompt: "그거 다시 설명해 줘",
      cwd: "/workspace",
      context: {
        memories: [{ type: "preference", content: "답변은 간결하게" }],
        history: [{ request: "구조 설명해 줘", answer: "Electron 앱이야." }],
      },
    });
    await vi.waitFor(() => expect(prompt).not.toBe(""));

    const order = [
      "Safety:",
      "Project guidance:",
      "Saved memories",
      "Recent conversation",
      "User request:\n그거 다시 설명해 줘",
    ].map((marker) => prompt.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
