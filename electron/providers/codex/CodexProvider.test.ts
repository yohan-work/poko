import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import type { AgentTask } from "../../shared";
import { CodexProvider, type SpawnProcess } from "./CodexProvider";

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;

  kill(signal?: NodeJS.Signals | number): boolean {
    if (this.killed) return false;
    this.killed = true;
    setImmediate(() => {
      this.stdout.end();
      this.stderr.end();
      this.emit("close", null, typeof signal === "string" ? signal : "SIGTERM");
    });
    return true;
  }

  finish(events: string[], code = 0, stderr = ""): void {
    setImmediate(() => {
      if (stderr) this.stderr.write(stderr);
      if (events.length) this.stdout.write(`${events.join("\n")}\n`);
      this.stdout.end();
      this.stderr.end();
      setImmediate(() => this.emit("close", code, null));
    });
  }
}

const task: AgentTask = {
  id: "task-1",
  prompt: "Analyze the project",
  cwd: "/selected/workspace",
  mode: "read",
};

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

function spawnFor(child: FakeChild): SpawnProcess {
  return vi.fn(() => child as unknown as ChildProcessWithoutNullStreams) as unknown as SpawnProcess;
}

const normalStream = [
  '{"type":"thread.started","thread_id":"thread-1"}',
  '{"type":"turn.started"}',
  '{"type":"item.started","item":{"id":"cmd-1","type":"command_execution","command":"ls"}}',
  '{"type":"item.completed","item":{"id":"msg-1","type":"agent_message","text":"Three improvements are available."}}',
  '{"type":"turn.completed","usage":{"output_tokens":4}}',
];

describe("CodexProvider", () => {
  it("runs Codex with JSONL and read-only permissions, then normalizes its events", async () => {
    const child = new FakeChild();
    let prompt = "";
    child.stdin.on("data", (chunk: Buffer) => {
      prompt += chunk.toString("utf8");
    });

    const spawnProcess = spawnFor(child);
    const provider = new CodexProvider({ executable: "/usr/local/bin/codex", spawnProcess });
    const eventPromise = collect(provider.runTask(task));
    child.finish(normalStream);
    const events = await eventPromise;

    expect(spawnProcess).toHaveBeenCalledWith(
      "/usr/local/bin/codex",
      [
        "--strict-config",
        "--ask-for-approval",
        "never",
        "--config",
        'default_permissions="poko-readonly"',
        "--config",
        'permissions={"poko-readonly"={extends=":read-only",filesystem={":root"="deny",":minimal"="read",":workspace_roots"={"."="read"}},network={enabled=false}}}',
        "exec",
        "--ignore-user-config",
        "--json",
        "--cd",
        "/selected/workspace",
        "-",
      ],
      expect.objectContaining({ cwd: "/selected/workspace", stdio: ["pipe", "pipe", "pipe"] }),
    );
    expect(prompt).toBe("Analyze the project");
    expect(events).toEqual([
      { type: "started" },
      { type: "thinking", message: "요청을 살펴보고 있어." },
      { type: "tool", tool: "terminal", detail: "프로젝트를 확인하고 있어." },
      { type: "output", content: "Three improvements are available." },
      { type: "completed", result: "Three improvements are available." },
    ]);
  });

  it("fails closed on write mode and malformed JSONL", async () => {
    const spawnProcess = vi.fn() as unknown as SpawnProcess;
    const provider = new CodexProvider({ spawnProcess });
    const writeEvents = await collect(provider.runTask({ ...task, mode: "write" }));
    expect(writeEvents).toEqual([
      { type: "error", error: "현재 포코는 읽기 전용 작업만 할 수 있어." },
    ]);
    expect(spawnProcess).not.toHaveBeenCalled();

    const child = new FakeChild();
    const malformedProvider = new CodexProvider({ spawnProcess: spawnFor(child) });
    const malformedPromise = collect(malformedProvider.runTask(task));
    child.finish(["not json"]);
    await expect(malformedPromise).resolves.toContainEqual({
      type: "error",
      error: "Codex 응답을 읽지 못했어. 다시 시도해 줘.",
    });
  });

  it("gives a clear message when Codex is missing", async () => {
    const child = new FakeChild();
    const spawnProcess = (() => {
      setImmediate(() => {
        child.emit("error", Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" }));
        child.stdout.end();
        child.stderr.end();
        child.emit("close", -2, null);
      });
      return child as unknown as ChildProcessWithoutNullStreams;
    }) as unknown as SpawnProcess;
    const provider = new CodexProvider({ spawnProcess });

    await expect(collect(provider.runTask(task))).resolves.toContainEqual({
      type: "error",
      error: "Codex를 찾지 못했어. Codex CLI 설치를 확인해 줘.",
    });
  });

  it("terminates and reports a task timeout", async () => {
    const child = new FakeChild();
    const provider = new CodexProvider({ spawnProcess: spawnFor(child), timeoutMs: 5 });

    await expect(collect(provider.runTask(task))).resolves.toContainEqual({
      type: "error",
      error: "작업이 오래 걸려서 멈췄어. 나눠서 다시 부탁해 줘.",
    });
    expect(child.killed).toBe(true);
  });
});
