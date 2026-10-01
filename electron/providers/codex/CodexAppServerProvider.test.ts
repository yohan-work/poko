import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentTask } from "../../shared";
import {
  CodexAppServerProvider,
  getFileChanges,
  isInside,
  touchesGitDirectory,
} from "./CodexAppServerProvider";

type Message = Record<string, unknown> & { id?: unknown; method?: string };

/** A scripted App Server that answers the handshake and records client replies. */
class FakeAppServer extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid: number | undefined;
  received: Message[] = [];
  killed = false;
  private waiters: Array<{ match: (message: Message) => boolean; resolve: (m: Message) => void }> =
    [];

  constructor() {
    super();
    let buffer = "";
    this.stdin.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const message = JSON.parse(buffer.slice(0, index)) as Message;
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
        this.handle(message);
      }
    });
  }

  send(message: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  waitFor(match: (message: Message) => boolean): Promise<Message> {
    const existing = this.received.find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => this.waiters.push({ match, resolve }));
  }

  kill(): boolean {
    if (this.killed) return false;
    this.killed = true;
    setImmediate(() => {
      this.stdout.end();
      this.stderr.end();
      this.emit("close", null, "SIGTERM");
    });
    return true;
  }

  private handle(message: Message): void {
    this.received.push(message);
    for (const waiter of this.waiters.filter((w) => w.match(message))) {
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      waiter.resolve(message);
    }
    if (message.method === "initialize") {
      this.send({ id: message.id, result: { userAgent: "codex/test" } });
    } else if (message.method === "thread/start") {
      this.send({ id: message.id, result: { thread: { id: "thread-1" } } });
    } else if (message.method === "turn/start") {
      this.send({ id: message.id, result: { turn: { id: "turn-1" } } });
      this.emit("turn");
    }
  }
}

const task: AgentTask = { id: "task-1", prompt: "Analyze", cwd: "/workspace", mode: "read" };

function providerFor(server: FakeAppServer, options = {}): CodexAppServerProvider {
  return new CodexAppServerProvider({
    executable: "codex",
    spawnProcess: () => server as unknown as ChildProcessWithoutNullStreams,
    ...options,
  });
}

/** Drains the provider stream in the background so the generator keeps running. */
function consume(iterable: AsyncIterable<AgentEvent>) {
  const events: AgentEvent[] = [];
  const listeners = new Set<() => void>();
  const done = (async () => {
    for await (const event of iterable) {
      events.push(event);
      for (const listener of listeners) listener();
    }
  })();
  return {
    events,
    done,
    next(type: AgentEvent["type"]): Promise<AgentEvent> {
      return new Promise((resolve) => {
        const check = (): void => {
          const found = events.find((event) => event.type === type);
          if (!found) return;
          listeners.delete(check);
          resolve(found);
        };
        listeners.add(check);
        check();
      });
    },
  };
}

const turnStarted = (server: FakeAppServer): Promise<void> =>
  new Promise((resolve) => server.once("turn", () => resolve()));

const commandApproval = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  method: "item/commandExecution/requestApproval",
  params: {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "cmd-1",
    startedAtMs: 1,
    command: "pnpm test",
    cwd: "/workspace",
    reason: "Run the tests",
    ...overrides,
  },
});

/** Starts a file-change item and asks to approve it, the way Codex does. */
function sendFileChange(
  server: FakeAppServer,
  { id = 7 as string | number, path = "src/a.ts", params = {} as Record<string, unknown> } = {},
) {
  server.send({
    method: "item/started",
    params: {
      item: {
        type: "fileChange",
        id: "patch-1",
        status: "inProgress",
        changes: [{ path, kind: { type: "update" }, diff: "-a\n+b" }],
      },
    },
  });
  server.send({
    id,
    method: "item/fileChange/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "patch-1",
      startedAtMs: 1,
      ...params,
    },
  });
}

describe("CodexAppServerProvider", () => {
  it("streams a read-only turn to completion", async () => {
    const server = new FakeAppServer();
    const provider = providerFor(server);
    const stream = consume(provider.runTask(task));
    await turnStarted(server);
    server.send({ method: "item/agentMessage/delta", params: { itemId: "m1", delta: "All " } });
    server.send({ method: "item/agentMessage/delta", params: { itemId: "m1", delta: "good." } });
    server.send({ method: "turn/completed", params: { turn: { status: "completed" } } });

    expect(await stream.next("completed")).toEqual({
      type: "completed",
      result: "All good.",
    });
    expect(stream.events.filter((event) => event.type === "output")).toEqual([
      { type: "output", content: "All ", itemId: "m1" },
      { type: "output", content: "good.", itemId: "m1" },
    ]);
    const thread = await server.waitFor((m) => m.method === "thread/start");
    expect(thread.params).toMatchObject({ sandbox: "read-only", approvalPolicy: "on-request" });
  });

  it("holds an approval until the owner answers it once", async () => {
    const server = new FakeAppServer();
    const provider = providerFor(server);
    const stream = consume(provider.runTask(task));
    await turnStarted(server);
    sendFileChange(server);

    expect(await stream.next("approvalRequired")).toMatchObject({
      requestId: "7",
      kind: "file_change",
      canApprove: true,
    });
    expect(provider.hasPendingApproval("other-task", "7")).toBe(false);
    expect(provider.respondToApproval("task-1", '"7"', "approve")).toBe(false);
    expect(provider.respondToApproval("task-1", "7", "approve")).toBe(true);
    expect(provider.respondToApproval("task-1", "7", "approve")).toBe(false);
    expect(await server.waitFor((m) => m.id === 7)).toEqual({
      id: 7,
      result: { decision: "accept" },
    });

    server.send({ method: "turn/completed", params: { turn: { status: "completed" } } });
    await stream.next("completed");
  });

  it.each([
    ["a plain command", {}],
    // The real shape: an execpolicy proposal and a decision list.
    [
      "with an execpolicy proposal",
      {
        command: "/bin/zsh -lc \"printf 'hi' > hello.txt\"",
        proposedExecpolicyAmendment: ["/bin/zsh", "-lc", "printf 'hi' > hello.txt"],
        availableDecisions: ["accept", "cancel"],
      },
    ],
    ["asking for network access", { networkApprovalContext: { host: "example.com" } }],
  ])("declines every command approval (%s) without asking", async (_label, overrides) => {
    const server = new FakeAppServer();
    const provider = providerFor(server);
    const stream = consume(provider.runTask(task));
    await turnStarted(server);
    server.send(commandApproval(overrides));

    expect(await stream.next("approvalRequired")).toMatchObject({
      kind: "command",
      canApprove: false,
      reason: expect.stringContaining("지원하지 않아"),
    });
    expect(await server.waitFor((m) => m.id === 7)).toEqual({
      id: 7,
      result: { decision: "decline" },
    });
    expect(provider.hasPendingApproval("task-1", "7")).toBe(false);
    server.kill();
  });

  it("declines a file change the server won't let us accept once", async () => {
    const server = new FakeAppServer();
    const provider = providerFor(server);
    const stream = consume(provider.runTask(task));
    await turnStarted(server);
    sendFileChange(server, { params: { availableDecisions: ["acceptForSession", "cancel"] } });

    expect(await stream.next("approvalRequired")).toMatchObject({ canApprove: false });
    expect(await server.waitFor((m) => m.id === 7)).toEqual({
      id: 7,
      result: { decision: "decline" },
    });
    server.kill();
  });

  it("previews file changes from the matching item", async () => {
    const server = new FakeAppServer();
    const provider = providerFor(server);
    const stream = consume(provider.runTask(task));
    await turnStarted(server);
    server.send({
      method: "item/started",
      params: {
        item: {
          type: "fileChange",
          id: "patch-1",
          status: "inProgress",
          changes: [{ path: "src/a.ts", kind: { type: "update" }, diff: "-a\n+b" }],
        },
      },
    });
    server.send({
      id: "fc",
      method: "item/fileChange/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "patch-1", startedAtMs: 1 },
    });

    expect(await stream.next("approvalRequired")).toMatchObject({
      kind: "file_change",
      canApprove: true,
      diff: [{ path: "src/a.ts", change: "update:\n-a\n+b" }],
    });
    expect(provider.respondToApproval("task-1", '"fc"', "decline")).toBe(true);
    expect(await server.waitFor((m) => m.id === "fc")).toEqual({
      id: "fc",
      result: { decision: "decline" },
    });
    server.kill();
  });

  it("rejects file changes that leave the workspace", () => {
    const change = (kind: Record<string, unknown>, path = "a.ts") => ({
      changes: [{ path, kind, diff: "" }],
    });
    expect(getFileChanges(change({ type: "add" }), "/workspace")).toHaveLength(1);
    expect(getFileChanges(change({ type: "add" }, "../outside.ts"), "/workspace")).toBeNull();
    expect(getFileChanges(change({ type: "delete" }, "/etc/hosts"), "/workspace")).toBeNull();
    expect(
      getFileChanges(change({ type: "update", move_path: "/tmp/x" }), "/workspace"),
    ).toBeNull();
    expect(getFileChanges(change({ type: "rename" }), "/workspace")).toBeNull();
    expect(getFileChanges({ changes: [] }, "/workspace")).toBeNull();
    expect(getFileChanges(change({ type: "update" }, ".git/config"), "/workspace")).toBeNull();
    expect(
      getFileChanges(change({ type: "add" }, ".GIT/hooks/pre-commit"), "/workspace"),
    ).toBeNull();
    expect(
      getFileChanges(change({ type: "update", move_path: ".git/config" }), "/workspace"),
    ).toBeNull();
  });

  it("fails closed on unsupported server requests", async () => {
    const server = new FakeAppServer();
    const provider = providerFor(server);
    const stream = consume(provider.runTask(task));
    await turnStarted(server);
    server.send({ id: 9, method: "item/permissions/requestApproval", params: {} });
    await stream.done;

    expect(await server.waitFor((m) => m.id === 9)).toMatchObject({
      id: 9,
      error: { code: -32601 },
    });
    expect(stream.events.filter((event) => event.type === "error")).toHaveLength(1);
    expect(server.killed).toBe(true);
  });

  it("cancels pending approvals when the task is aborted", async () => {
    const server = new FakeAppServer();
    const provider = providerFor(server);
    const controller = new AbortController();
    const stream = consume(provider.runTask(task, { signal: controller.signal }));
    await turnStarted(server);
    sendFileChange(server);
    await stream.next("approvalRequired");

    controller.abort();
    expect(await server.waitFor((m) => m.id === 7)).toEqual({
      id: 7,
      result: { decision: "cancel" },
    });
    expect(await stream.next("cancelled")).toEqual({ type: "cancelled" });
    expect(provider.hasPendingApproval("task-1", "7")).toBe(false);
  });

  it("stops the task when an approval is not answered in time", async () => {
    const server = new FakeAppServer();
    const provider = providerFor(server, { approvalTimeoutMs: 20 });
    const stream = consume(provider.runTask(task));
    await turnStarted(server);
    sendFileChange(server);
    await stream.next("approvalRequired");

    expect(await server.waitFor((m) => m.id === 7)).toEqual({
      id: 7,
      result: { decision: "cancel" },
    });
    expect(await stream.next("error")).toMatchObject({
      error: expect.stringContaining("오래 기다려서"),
    });
    expect(provider.respondToApproval("task-1", "7", "approve")).toBe(false);
  });

  it("refuses write mode before starting Codex", async () => {
    let spawned = false;
    const provider = new CodexAppServerProvider({
      spawnProcess: () => {
        spawned = true;
        return new FakeAppServer() as unknown as ChildProcessWithoutNullStreams;
      },
    });
    const events: AgentEvent[] = [];
    for await (const event of provider.runTask({ ...task, mode: "write" })) events.push(event);
    expect(spawned).toBe(false);
    expect(events).toEqual([{ type: "error", error: expect.any(String) }]);
  });

  it("keeps going when Codex reports an error it will retry", async () => {
    const server = new FakeAppServer();
    const provider = providerFor(server);
    const stream = consume(provider.runTask(task));
    await turnStarted(server);
    server.send({
      method: "error",
      params: { error: { message: "stream lost" }, willRetry: true },
    });
    server.send({ method: "item/agentMessage/delta", params: { delta: "Recovered." } });
    server.send({ method: "turn/completed", params: { turn: { status: "completed" } } });

    expect(await stream.next("completed")).toEqual({ type: "completed", result: "Recovered." });
    expect(stream.events.some((event) => event.type === "error")).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "stops the whole process group so approved commands do not outlive the task",
    async () => {
      const server = new FakeAppServer();
      server.pid = 4242;
      const kill = vi.spyOn(process, "kill").mockImplementation(() => {
        server.kill();
        return true;
      });
      try {
        const provider = providerFor(server);
        const controller = new AbortController();
        const stream = consume(provider.runTask(task, { signal: controller.signal }));
        await turnStarted(server);
        controller.abort();
        await stream.done;
        expect(kill).toHaveBeenCalledWith(-4242, "SIGTERM");
      } finally {
        kill.mockRestore();
      }
    },
  );

  it("does not treat a path through a symlink as inside the workspace", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "poko-symlink-")));
    try {
      const workspace = join(base, "workspace");
      const outside = join(base, "outside");
      await mkdir(workspace);
      await mkdir(outside);
      await symlink(outside, join(workspace, "linked"));
      await symlink(join(base, "missing"), join(workspace, "dangling"));

      expect(isInside(workspace, join(workspace, "src", "new.ts"))).toBe(true);
      expect(isInside(workspace, join(workspace, "linked", "config"))).toBe(false);
      expect(isInside(workspace, join(workspace, "dangling"))).toBe(false);
      // A symlink into .git is still .git.
      await mkdir(join(workspace, ".git", "hooks"), { recursive: true });
      await symlink(join(workspace, ".git", "hooks"), join(workspace, "hooks"));
      expect(touchesGitDirectory(workspace, "hooks/pre-commit")).toBe(true);
      expect(touchesGitDirectory(workspace, "GIT~1/config")).toBe(true);
      expect(touchesGitDirectory(workspace, ".git./config")).toBe(true);
      expect(touchesGitDirectory(workspace, "src/app.ts")).toBe(false);
      expect(
        getFileChanges(
          { changes: [{ path: "hooks/pre-commit", kind: { type: "add" }, diff: "" }] },
          workspace,
        ),
      ).toBeNull();
      expect(
        getFileChanges(
          { changes: [{ path: "linked/config", kind: { type: "add" }, diff: "" }] },
          workspace,
        ),
      ).toBeNull();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("accepts a file change once, never for the session", async () => {
    const server = new FakeAppServer();
    const provider = providerFor(server);
    const stream = consume(provider.runTask(task));
    await turnStarted(server);
    sendFileChange(server, {
      params: { availableDecisions: ["accept", "acceptForSession", "cancel"] },
    });

    expect(await stream.next("approvalRequired")).toMatchObject({ canApprove: true });
    expect(provider.respondToApproval("task-1", "7", "approve")).toBe(true);
    expect(await server.waitFor((m) => m.id === 7)).toEqual({
      id: 7,
      result: { decision: "accept" },
    });
    server.kill();
  });

  it("refuses with decline even when the server's list omits it, so the task can continue", async () => {
    const server = new FakeAppServer();
    const provider = providerFor(server);
    const stream = consume(provider.runTask(task));
    await turnStarted(server);
    sendFileChange(server, { params: { availableDecisions: ["accept", "cancel"] } });

    await stream.next("approvalRequired");
    expect(provider.respondToApproval("task-1", "7", "decline")).toBe(true);
    expect(await server.waitFor((m) => m.id === 7)).toEqual({
      id: 7,
      result: { decision: "decline" },
    });
    server.kill();
  });
});
