import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentTask } from "../../shared";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeProvider, claudeArgs, EDIT_TOOLS, READ_TOOLS } from "./ClaudeCodeProvider";

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

function run(script: Script, signal?: AbortSignal, runTask: AgentTask = task) {
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
    for await (const event of provider.runTask(runTask, { signal })) events.push(event);
    return events;
  };
  return { collect, provider, fake: () => fake as FakeClaude, spawned: () => spawned };
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

  describe("edits", () => {
    let root: string;
    const editRequest = (id: string, input: Record<string, unknown>) => ({
      type: "control_request",
      request_id: id,
      request: { subtype: "can_use_tool", tool_name: "Edit", input },
    });

    function editTask(script: Script) {
      return run(script, undefined, { ...task, cwd: root, editsEnabled: true });
    }

    it("blames the model only when one was picked, after sign-in", async () => {
      const failing = (text: string, model?: string) =>
        run(
          (message, claude) => {
            if (message.type === "user")
              claude.send(init(), {
                type: "result",
                subtype: "success",
                is_error: true,
                result: text,
              });
          },
          undefined,
          { ...task, ...(model ? { model } : {}) },
        ).collect();
      const modelMessage =
        "이 모델은 지금 계정에서 쓸 수 없어. 입력창 아래에서 모델을 기본값으로 바꿔 줘.";
      expect((await failing("model: not-a-model not found", "not-a-model")).at(-1)).toEqual({
        type: "error",
        error: modelMessage,
      });
      expect((await failing("model: claude-x not found")).at(-1)).toEqual({
        type: "error",
        error: "Claude Code 작업을 마치지 못했어. 다시 시도해 줘.",
      });
      expect((await failing("401 unauthorized for model opus: no access", "opus")).at(-1)).toEqual({
        type: "error",
        error: "Claude Code 로그인이 필요해. 터미널에서 claude를 실행해 로그인해 줘.",
      });
    });

    it("passes a picked model and nothing otherwise", () => {
      expect(claudeArgs(READ_TOOLS, "opus")).toEqual(expect.arrayContaining(["--model", "opus"]));
      expect(claudeArgs(READ_TOOLS)).not.toContain("--model");
    });

    it("offers edit tools only when edits are on", () => {
      expect(claudeArgs([...READ_TOOLS, ...EDIT_TOOLS]).at(-1)).toBe("Read,Grep,Glob,Edit,Write");
    });

    it("turns an Edit into a card and allows it once approved", async () => {
      root = mkdtempSync(join(tmpdir(), "poko-claude-task-"));
      writeFileSync(join(root, "README.md"), "# Sample\n");
      const input = {
        file_path: join(root, "README.md"),
        old_string: "# Sample",
        new_string: "# Poko",
      };
      const events: AgentEvent[] = [];
      const { provider, fake } = editTask((message, claude) => {
        if (message.type === "user")
          claude.send(init({ tools: [...READ_TOOLS, ...EDIT_TOOLS] }), editRequest("e1", input));
        if (message.type === "control_response") claude.send(result("바꿨어."));
      });
      const iterator = provider
        .runTask({ ...task, cwd: root, editsEnabled: true })
        [Symbol.asyncIterator]();
      for (;;) {
        const next = await iterator.next();
        if (next.done) break;
        events.push(next.value);
        if (next.value.type === "approvalRequired") {
          expect(next.value).toMatchObject({
            kind: "file_change",
            canApprove: true,
            diff: [{ path: join(root, "README.md"), change: "update:\n@@\n-# Sample\n+# Poko" }],
          });
          expect(provider.fileChangePaths("t1", "e1")).toEqual([join(root, "README.md")]);
          expect(provider.canStillApprove("t1", "e1")).toBe(true);
          expect(provider.respondToApproval("t1", "e1", "approve")).toBe(true);
          expect(provider.respondToApproval("t1", "e1", "approve")).toBe(false);
        }
      }
      expect(fake().received.at(-1)).toMatchObject({
        response: { request_id: "e1", response: { behavior: "allow", updatedInput: input } },
      });
      expect(events.at(-1)).toEqual({ type: "completed", result: "바꿨어." });
      rmSync(root, { recursive: true, force: true });
    });

    it("can't approve once the file changed, and denies refused edits at once", async () => {
      root = mkdtempSync(join(tmpdir(), "poko-claude-task-"));
      writeFileSync(join(root, "README.md"), "# Sample\n");
      const { provider, fake } = editTask((message, claude) => {
        if (message.type === "user")
          claude.send(
            init({ tools: [...READ_TOOLS, ...EDIT_TOOLS] }),
            editRequest("bad", { file_path: "/etc/hosts", old_string: "a", new_string: "b" }),
            editRequest("e1", {
              file_path: join(root, "README.md"),
              old_string: "# Sample",
              new_string: "# Poko",
            }),
          );
      });
      const iterator = provider
        .runTask({ ...task, cwd: root, editsEnabled: true })
        [Symbol.asyncIterator]();
      const cards: AgentEvent[] = [];
      while (cards.length < 2) {
        const next = await iterator.next();
        if (next.value?.type === "approvalRequired") cards.push(next.value);
      }
      expect(cards[0]).toMatchObject({
        requestId: "bad",
        canApprove: false,
        reason: "작업 폴더 밖의 파일이라 거절했어.",
      });
      expect(
        fake().received.find(
          (m) => (m.response as { request_id?: string } | undefined)?.request_id === "bad",
        ),
      ).toMatchObject({
        response: { response: { behavior: "deny" } },
      });
      writeFileSync(join(root, "README.md"), "# Changed by hand\n");
      expect(provider.canStillApprove("t1", "e1")).toBe(false);
      fake().send(result("끝"));
      for (;;) if ((await iterator.next()).done) break;
      // The pending card is declined when the task ends.
      expect(fake().received.at(-1)).toMatchObject({
        response: { request_id: "e1", response: { behavior: "deny" } },
      });
      expect(readFileSync(join(root, "README.md"), "utf8")).toBe("# Changed by hand\n");
      rmSync(root, { recursive: true, force: true });
    });

    it("stops the task when an approval isn't answered in time", async () => {
      root = mkdtempSync(join(tmpdir(), "poko-claude-task-"));
      writeFileSync(join(root, "README.md"), "# Sample\n");
      let fake: FakeClaude | undefined;
      const provider = new ClaudeCodeProvider({
        runtime: () => ({ executable: "/bin/claude", environment: {} }),
        spawnProcess: () => {
          fake = new FakeClaude((message, claude) => {
            if (message.type === "user")
              claude.send(
                init({ tools: [...READ_TOOLS, ...EDIT_TOOLS] }),
                editRequest("e1", {
                  file_path: join(root, "README.md"),
                  old_string: "# Sample",
                  new_string: "# Poko",
                }),
              );
          });
          return fake as unknown as ChildProcessWithoutNullStreams;
        },
        approvalTimeoutMs: 10,
      });
      const events: AgentEvent[] = [];
      for await (const event of provider.runTask({ ...task, cwd: root, editsEnabled: true }))
        events.push(event);
      expect(fake?.killed).toBe(true);
      expect(fake?.received.at(-1)).toMatchObject({
        response: { request_id: "e1", response: { behavior: "deny" } },
      });
      expect(events.at(-1)).toEqual({
        type: "error",
        error: "확인을 오래 기다려서 작업을 멈췄어. 다시 요청해 줘.",
      });
      expect(provider.hasPendingApproval("t1", "e1")).toBe(false);
      rmSync(root, { recursive: true, force: true });
    });

    it("denies Edit when edits are off", async () => {
      const { collect, fake } = run((message, claude) => {
        if (message.type === "user")
          claude.send(
            init(),
            editRequest("e1", {
              file_path: "/w/project/README.md",
              old_string: "a",
              new_string: "b",
            }),
          );
        if (message.type === "control_response") claude.send(result("못 바꿨어."));
      });
      const events = await collect();
      expect(events.some((event) => event.type === "approvalRequired")).toBe(false);
      expect(fake().received.at(-1)).toMatchObject({
        response: { response: { behavior: "deny" } },
      });
    });
  });
});
