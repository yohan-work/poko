import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentTask } from "../../shared";
import { isUnavailableModelError } from "../../shared";
import {
  CodexAppServerProvider,
  disabledFeatures,
  editRefusal,
  getFileChanges,
  isInside,
  parseFeatureList,
  permissionProfile,
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

const task: AgentTask = {
  id: "task-1",
  prompt: "Analyze",
  cwd: "/workspace",
  mode: "read",
  editsEnabled: true,
};

/** Every feature name Poko may disable, as a current Codex would list them. */
const allFeatures = new Set([
  "computer_use",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "in_app_browser",
  "in_app_local_automation",
  "shell_tool",
  "unified_exec",
  "memories",
  "apps",
  "plugins",
  "multi_agent",
  "image_generation",
  "view_image",
]);

function providerFor(server: FakeAppServer, options = {}): CodexAppServerProvider {
  return new CodexAppServerProvider({
    executable: "codex",
    spawnProcess: () => server as unknown as ChildProcessWithoutNullStreams,
    listFeatures: async () => allFeatures,
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
      reason: expect.stringContaining("Claude Code로 바꾸면"),
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
    // A patch that lays out a bare repository (HEAD or config beside objects/ or refs/).
    const many = (...paths: string[]) => ({
      changes: paths.map((path) => ({ path, kind: { type: "add" }, diff: "" })),
    });
    expect(
      getFileChanges(many("tools/HEAD", "tools/objects/x", "tools/refs/x"), "/workspace"),
    ).toBeNull();
    // Without a HEAD file git sees no repository, so config beside objects/ and refs/ is fine.
    expect(
      getFileChanges(
        many("tools/config", "tools/objects/x", "tools/refs/heads/main"),
        "/workspace",
      ),
    ).toHaveLength(3);
    for (const name of ["HEAD", "head.", "commondir", "gitdir", "packed-refs"]) {
      expect(getFileChanges(many(`a/${name}`), "/workspace")).toBeNull();
    }
    expect(getFileChanges(many("src/config", "src/app.ts"), "/workspace")).toHaveLength(2);
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
      expect(touchesGitDirectory(workspace, ".git::$INDEX_ALLOCATION/config")).toBe(
        process.platform === "win32",
      );
      expect(touchesGitDirectory(workspace, "notes/2026-10-01T10:00.md")).toBe(
        process.platform === "win32",
      );
      expect(touchesGitDirectory(workspace, "src/app.ts")).toBe(false);
      // A bare-repository layout split across patches, in other letter case, or via a symlink.
      await mkdir(join(workspace, "x"));
      await writeFile(join(workspace, "x", "HEAD"), "ref: refs/heads/main");
      const add = (...paths: string[]) => ({
        changes: paths.map((path) => ({ path, kind: { type: "add" }, diff: "" })),
      });
      expect(getFileChanges(add("x/objects/a", "x/refs/a"), workspace)).toBeNull();
      expect(getFileChanges(add("y/HEAD", "y/Objects/a", "y/Refs/a"), workspace)).toBeNull();
      expect(getFileChanges(add("z/HEAD.", "z/objects/a", "z/refs./a"), workspace)).toBeNull();
      await mkdir(join(workspace, "sub"));
      await symlink(join(workspace, "sub"), join(workspace, "link"));
      expect(getFileChanges(add("X/HEAD", "x/objects/o", "x/refs/r"), workspace)).toBeNull();
      // Writing into a folder that already holds HEAD, even through a symlink or another case.
      await symlink(join(workspace, "x"), join(workspace, "xlink"));
      expect(getFileChanges(add("xlink/config"), workspace)).toBeNull();
      // Ordinary config/ and objects/ folders are not a repository.
      await mkdir(join(workspace, "app", "config"), { recursive: true });
      await mkdir(join(workspace, "app", "objects"));
      await mkdir(join(workspace, "app", "refs"));
      expect(getFileChanges(add("app/main.ts"), workspace)).toHaveLength(1);
      expect(getFileChanges(add("src/config", "src/app.ts"), workspace)).toHaveLength(2);
      // An absolute path inside the workspace is judged only below the workspace.
      expect(touchesGitDirectory(workspace, join(workspace, "src", "app.ts"))).toBe(false);
      expect(touchesGitDirectory(workspace, join(workspace, ".git", "config"))).toBe(true);
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

  it("re-checks a pending file change before it is approved", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "poko-recheck-")));
    try {
      const server = new FakeAppServer();
      const provider = providerFor(server);
      const stream = consume(provider.runTask({ ...task, cwd: base }));
      await turnStarted(server);
      server.send({
        method: "item/started",
        params: {
          item: {
            type: "fileChange",
            id: "patch-1",
            status: "inProgress",
            changes: [{ path: "t/objects/x", kind: { type: "add" }, diff: "" }],
          },
        },
      });
      server.send({
        id: "a",
        method: "item/fileChange/requestApproval",
        params: { threadId: "thread-1", turnId: "turn-1", itemId: "patch-1", startedAtMs: 1 },
      });
      await stream.next("approvalRequired");
      expect(provider.canStillApprove("task-1", '"a"')).toBe(true);
      // Meanwhile the folder gains HEAD and refs/ on disk.
      await mkdir(join(base, "t", "refs"), { recursive: true });
      await writeFile(join(base, "t", "HEAD"), "ref: refs/heads/main");
      expect(provider.canStillApprove("task-1", '"a"')).toBe(false);
      // A folder swapped for a symlink to .git after the offer is caught too.
      await rm(join(base, "t"), { recursive: true, force: true });
      await mkdir(join(base, ".git"));
      await symlink(join(base, ".git"), join(base, "t"));
      expect(provider.canStillApprove("task-1", '"a"')).toBe(false);
      server.kill();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("turns off Codex's own computer and browser control, but only flags this Codex knows", () => {
    expect(disabledFeatures("project", allFeatures)).toEqual(
      expect.arrayContaining(["computer_use", "browser_use", "in_app_local_automation"]),
    );
    expect(disabledFeatures("project", allFeatures)).not.toContain("shell_tool");
    // `--disable` with an unknown name stops Codex from starting, so unknown names are skipped.
    expect(disabledFeatures("project", new Set(["computer_use", "shell_tool"]))).toEqual([
      "computer_use",
    ]);
    expect(disabledFeatures("project", null)).toEqual([]);
    // A screen task can't be contained without turning the shell off.
    expect(disabledFeatures("screen", new Set(["computer_use"]))).toBeNull();
    expect(disabledFeatures("screen", null)).toBeNull();
    expect(
      parseFeatureList(
        "apps                stable   true\nshell_tool          stable   true\nWARNING: x\n",
      ),
    ).toEqual(new Set(["apps", "shell_tool"]));
  });

  it("refuses a screen task on a Codex that can't turn its shell off", async () => {
    let spawned = false;
    const provider = new CodexAppServerProvider({
      spawnProcess: () => {
        spawned = true;
        return new FakeAppServer() as unknown as ChildProcessWithoutNullStreams;
      },
      listFeatures: async () => new Set(["computer_use"]),
    });
    const events: AgentEvent[] = [];
    for await (const event of provider.runTask({ ...task, profile: "screen" })) events.push(event);
    expect(spawned).toBe(false);
    expect(events).toEqual([{ type: "error", error: expect.stringContaining("업데이트") }]);
  });

  it("declines file changes during a screen task", async () => {
    const server = new FakeAppServer();
    const provider = providerFor(server);
    const stream = consume(provider.runTask({ ...task, profile: "screen" }));
    await turnStarted(server);
    sendFileChange(server);
    expect(await stream.next("approvalRequired")).toMatchObject({
      kind: "file_change",
      canApprove: false,
    });
    expect(await server.waitFor((m) => m.id === 7)).toEqual({
      id: 7,
      result: { decision: "decline" },
    });
    server.kill();
    await stream.done;
  });

  it("runs screen tasks with no shell, no file reads beyond the work folder, and the screenshot attached", async () => {
    const server = new FakeAppServer();
    const args: string[] = [];
    const provider = new CodexAppServerProvider({
      executable: "codex",
      spawnProcess: (_command, spawnArgs) => {
        args.push(...spawnArgs);
        return server as unknown as ChildProcessWithoutNullStreams;
      },
      listFeatures: async () => allFeatures,
    });
    const stream = consume(
      provider.runTask({ ...task, profile: "screen", images: ["/tmp/screen.png"] }),
    );
    await turnStarted(server);
    expect(args.join(" ")).toContain("--disable shell_tool");
    expect(args.join(" ")).toContain("--disable view_image");
    expect(args.join(" ")).not.toContain('":minimal"');
    const thread = await server.waitFor((m) => m.method === "thread/start");
    expect(JSON.stringify(thread.params)).not.toContain(":minimal");
    const turn = await server.waitFor((m) => m.method === "turn/start");
    expect((turn.params as { input: unknown[] }).input).toEqual([
      { type: "text", text: "Analyze" },
      { type: "localImage", path: "/tmp/screen.png" },
    ]);
    expect(permissionProfile("project").filesystem).toHaveProperty(":minimal", "read");
    server.kill();
    await stream.done;
  });

  it("declines file changes while edits are off, and moves even when they are on", async () => {
    const off = new FakeAppServer();
    const offStream = consume(providerFor(off).runTask({ ...task, editsEnabled: false }));
    await turnStarted(off);
    sendFileChange(off);
    expect(await offStream.next("approvalRequired")).toMatchObject({
      kind: "file_change",
      canApprove: false,
      reason: expect.stringContaining("수정이 꺼져 있어"),
    });
    expect(await off.waitFor((m) => m.id === 7)).toEqual({
      id: 7,
      result: { decision: "decline" },
    });
    off.kill();
    await offStream.done;

    expect(
      editRefusal({
        changes: [{ path: "a.ts", kind: { type: "update", move_path: "b.ts" }, diff: "" }],
      }),
    ).toContain("옮기기");
    expect(
      editRefusal({
        changes: [{ path: "a.png", kind: { type: "update" }, diff: "Binary files a and b differ" }],
      }),
    ).toContain("바이너리");
    expect(
      editRefusal({ changes: [{ path: "a.ts", kind: { type: "update" }, diff: "-a\n+b" }] }),
    ).toBeNull();
    // A new text file may mention git's binary message in its content.
    expect(
      editRefusal({
        changes: [
          {
            path: "notes.md",
            kind: { type: "add" },
            diff: "# Notes\nBinary files a and b differ\nmore",
          },
        ],
      }),
    ).toBeNull();
  });

  it("starts the thread with the picked model and explains a model the account can't use", async () => {
    const server = new FakeAppServer();
    const run = consume(
      providerFor(server).runTask({ ...task, model: "gpt-6-astra", effort: "high" }),
    );
    await turnStarted(server);
    expect(server.received.find((message) => message.method === "thread/start")).toMatchObject({
      params: { model: "gpt-6-astra", config: { model_reasoning_effort: "high" } },
    });
    server.send({
      method: "error",
      params: {
        error: {
          message: "The model `gpt-6-astra` does not exist or you do not have access to it.",
        },
        willRetry: false,
      },
    });
    await run.done;
    expect(run.events.at(-1)).toEqual({
      type: "error",
      error: "이 모델은 지금 계정에서 쓸 수 없어. 입력창 아래에서 모델을 기본값으로 바꿔 줘.",
    });
  });

  it("recognizes Codex's wording for a model the account can't use", () => {
    expect(
      isUnavailableModelError(
        "The 'gpt-5-codex-mini' model is not supported when using Codex with a ChatGPT account.",
      ),
    ).toBe(true);
    expect(isUnavailableModelError("Image input is not supported by this model")).toBe(false);
  });

  it("keeps the usual message for other errors, even with a model picked", async () => {
    const server = new FakeAppServer();
    const run = consume(providerFor(server).runTask({ ...task, model: "gpt-6-astra" }));
    await turnStarted(server);
    server.send({
      method: "error",
      params: { error: { message: "model stream disconnected" }, willRetry: true },
    });
    server.send({
      method: "error",
      params: {
        error: { message: "Image input is not supported by this model" },
        willRetry: false,
      },
    });
    await run.done;
    expect(run.events.at(-1)).toEqual({
      type: "error",
      error: "Codex App Server에서 오류가 발생했어. 다시 시도해 줘.",
    });
  });

  it("leaves the model to Codex when none is picked", async () => {
    const server = new FakeAppServer();
    const run = consume(providerFor(server).runTask(task));
    await turnStarted(server);
    const start = server.received.find((message) => message.method === "thread/start");
    expect((start?.params as Record<string, unknown> | undefined)?.model).toBeUndefined();
    server.send({ method: "turn/completed", params: { turn: { status: "completed" } } });
    await run.done;
  });

  it("lists the models Codex offers, without hidden ones", async () => {
    const server = new FakeAppServer();
    server.on("listing", () => undefined);
    const original = server.send.bind(server);
    server.stdin.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n").filter(Boolean)) {
        const message = JSON.parse(line) as Message;
        if (message.method === "model/list")
          original({
            id: message.id,
            result: {
              data: [
                {
                  id: "a",
                  model: "gpt-a",
                  displayName: "GPT-A",
                  isDefault: true,
                  hidden: false,
                  supportedReasoningEfforts: [
                    { reasoningEffort: "low" },
                    { reasoningEffort: "high" },
                    { reasoningEffort: "ultra" },
                  ],
                },
                { id: "b", model: "gpt-b", displayName: "GPT-B", hidden: true },
                { id: "c", model: "gpt-c", hidden: false },
              ],
            },
          });
      }
    });
    expect(await providerFor(server).listModels()).toEqual([
      { id: "gpt-a", label: "GPT-A", isDefault: true, efforts: ["low", "high"] },
      { id: "gpt-c", label: "gpt-c" },
    ]);
    expect(server.killed).toBe(true);
  });
});
