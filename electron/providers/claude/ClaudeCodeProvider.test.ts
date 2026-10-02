import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentTask } from "../../shared";
import { ClaudeCodeProvider, claudeArgs, promptFor, READ_TOOLS } from "./ClaudeCodeProvider";

type Script = (message: Record<string, unknown>, fake: FakeClaude) => void;

class FakeClaude extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = undefined;
  received: Array<Record<string, unknown>> = [];
  killed = false;

  constructor(script: Script) {
    super();
    let buffer = "";
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk: string) => {
      buffer += chunk;
      for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
        const message = JSON.parse(buffer.slice(0, index)) as Record<string, unknown>;
        buffer = buffer.slice(index + 1);
        this.received.push(message);
        script(message, this);
      }
    });
  }

  send(...messages: unknown[]): void {
    for (const message of messages) this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  close(): void {
    this.stdout.end();
    this.emit("close", 0);
  }

  kill(): boolean {
    this.killed = true;
    this.close();
    return true;
  }
}

const init = (overrides: Record<string, unknown> = {}) => ({
  type: "system",
  subtype: "init",
  permissionMode: "default",
  tools: [...READ_TOOLS],
  ...overrides,
});
const delta = (text: string) => ({
  type: "stream_event",
  event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
});
const result = (text: string) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result: text,
});

const task: AgentTask = {
  id: "t1",
  prompt: "README 요약해 줘",
  cwd: "/w/project",
  mode: "read",
  profile: "project",
};

function run(script: Script, signal?: AbortSignal) {
  let fake: FakeClaude | undefined;
  let spawned: { command: string; args: string[] } | undefined;
  const provider = new ClaudeCodeProvider({
    runtime: () => ({ executable: "/bin/claude", environment: {} }),
    spawnProcess: (command, args) => {
      spawned = { command, args };
      fake = new FakeClaude(script);
      return fake as unknown as ChildProcessWithoutNullStreams;
    },
    interruptGraceMs: 10,
  });
  const collect = async () => {
    const events: AgentEvent[] = [];
    for await (const event of provider.runTask(task, { signal })) events.push(event);
    return events;
  };
  return { collect, fake: () => fake as FakeClaude, spawned: () => spawned };
}

describe("ClaudeCodeProvider", () => {
  it("starts Claude Code without settings files, in default mode, with read tools only", () => {
    const args = claudeArgs(READ_TOOLS);
    expect(args).toEqual(expect.arrayContaining(["--safe-mode", "--strict-mcp-config"]));
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("default");
    expect(args[args.indexOf("--permission-prompt-tool") + 1]).toBe("stdio");
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Grep,Glob");
  });

  it("sends the prompt and maps the stream to events", async () => {
    const { collect, fake, spawned } = run((message, claude) => {
      if (message.type !== "user") return;
      claude.send(
        init(),
        { type: "stream_event", event: { type: "message_start", message: { id: "m1" } } },
        {
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Read", input: { file_path: "/w/project/README.md" } },
            ],
          },
        },
        delta("요약"),
        delta("이야."),
        result("요약이야."),
      );
    });
    const events = await collect();
    expect(spawned()?.command).toBe("/bin/claude");
    expect(fake().received.map((message) => message.type)).toEqual(["control_request", "user"]);
    expect(fake().received[1]).toMatchObject({ message: { content: "README 요약해 줘" } });
    expect(events).toEqual([
      { type: "started" },
      { type: "tool", tool: "Read", detail: "README.md 파일을 읽고 있어." },
      { type: "output", content: "요약", itemId: "m1" },
      { type: "output", content: "이야.", itemId: "m1" },
      { type: "completed", result: "요약이야." },
    ]);
    expect(fake().killed).toBe(true);
  });

  it("denies every permission request in read-only mode", async () => {
    const { collect, fake } = run((message, claude) => {
      if (message.type === "user")
        claude.send(init(), {
          type: "control_request",
          request_id: "p1",
          request: {
            subtype: "can_use_tool",
            tool_name: "Read",
            input: { file_path: "/etc/hosts" },
          },
        });
      if (message.type === "control_response") claude.send(result("못 읽었어."));
    });
    const events = await collect();
    expect(fake().received.at(-1)).toMatchObject({
      type: "control_response",
      response: { request_id: "p1", response: { behavior: "deny" } },
    });
    expect(events.at(-1)).toEqual({ type: "completed", result: "못 읽었어." });
  });

  it("stops if the CLI reports a wider permission mode or extra tools", async () => {
    for (const reported of [
      init({ permissionMode: "acceptEdits" }),
      init({ tools: ["Read", "Bash"] }),
    ]) {
      const { collect } = run((message, claude) => {
        if (message.type === "user") claude.send(reported, delta("x"), result("x"));
      });
      const events = await collect();
      expect(events).toEqual([
        { type: "error", error: "Claude Code가 포코의 제한 설정대로 시작하지 않아서 멈췄어." },
      ]);
    }
  });

  it("turns errors, broken output, and an early exit into plain messages", async () => {
    const signedOut = run((message, claude) => {
      if (message.type === "user")
        claude.send(init(), {
          type: "result",
          subtype: "success",
          is_error: true,
          result: "Not logged in · Please run /login",
        });
    });
    expect((await signedOut.collect()).at(-1)).toEqual({
      type: "error",
      error: "Claude Code 로그인이 필요해. 터미널에서 claude를 실행해 로그인해 줘.",
    });

    const broken = run((message, claude) => {
      if (message.type === "user") claude.stdout.write("not json\n");
    });
    expect((await broken.collect()).at(-1)).toEqual({
      type: "error",
      error: "Claude Code가 읽을 수 없는 응답을 보냈어.",
    });

    const exited = run((message, claude) => {
      if (message.type === "user") {
        claude.send(init());
        claude.close();
      }
    });
    expect((await exited.collect()).at(-1)).toEqual({
      type: "error",
      error: "Claude Code 작업을 마치지 못했어. 다시 시도해 줘.",
    });
  });

  it("keeps the specific error when output breaks while it is waiting", async () => {
    const { collect } = run((message, claude) => {
      if (message.type === "user") {
        claude.send(init());
        setTimeout(() => claude.stdout.write("not json\n"), 10);
      }
    });
    expect((await collect()).at(-1)).toEqual({
      type: "error",
      error: "Claude Code가 읽을 수 없는 응답을 보냈어.",
    });
  });

  it("ignores a result that follows broken output in the same chunk", async () => {
    const { collect } = run((message, claude) => {
      if (message.type === "user") {
        claude.send(init());
        setTimeout(() => claude.stdout.write(`not json\n${JSON.stringify(result("x"))}\n`), 10);
      }
    });
    expect((await collect()).at(-1)).toEqual({
      type: "error",
      error: "Claude Code가 읽을 수 없는 응답을 보냈어.",
    });
  });

  it("asks for a description instead of an edit while edits aren't offered", () => {
    expect(promptFor(task)).toBe(task.prompt);
    expect(promptFor({ ...task, editsEnabled: true })).toContain("Describe the exact change");
  });

  it("interrupts on cancel and ends as cancelled", async () => {
    const controller = new AbortController();
    const { collect, fake } = run((message, claude) => {
      if (message.type === "user") {
        claude.send(init(), delta("생각 중"));
        setTimeout(() => controller.abort(), 5);
      }
      if (
        message.type === "control_request" &&
        (message.request as { subtype?: string }).subtype === "interrupt"
      )
        claude.send({ type: "result", subtype: "error_during_execution", is_error: true });
    }, controller.signal);
    const events = await collect();
    expect(
      fake().received.some(
        (message) => (message.request as { subtype?: string } | undefined)?.subtype === "interrupt",
      ),
    ).toBe(true);
    expect(events.at(-1)).toEqual({ type: "cancelled" });
  });
});
