import {
  spawn as nodeSpawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
} from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentEvent, AgentTask, ApprovalChoice } from "../../shared";
import type { AgentProvider } from "../../agent/AgentProvider";
import { signalProcess } from "./CodexProvider";
import {
  encodeRequestId,
  isRecord,
  parseIncomingMessage,
  readString,
  type IncomingMessage,
  type JsonRpcId,
} from "./appServerProtocol";

const MAX_LINE_LENGTH = 1024 * 1024;
const MAX_DIFF_LENGTH = 120_000;
const REQUEST_TIMEOUT_MS = 20_000;
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const TASK_TIMEOUT_MS = 10 * 60 * 1000;
const APPROVAL_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
]);

class ProviderFailure extends Error {}

export type AppServerSpawn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

class MessageQueue implements AsyncIterable<IncomingMessage> {
  private values: IncomingMessage[] = [];
  private waiters: Array<Deferred<IteratorResult<IncomingMessage>>> = [];
  private failure: Error | null = null;
  private ended = false;

  push(value: IncomingMessage): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.values.push(value);
  }

  fail(error: Error): void {
    this.failure = error;
    this.finish();
  }

  finish(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) {
      if (this.failure) waiter.reject(this.failure);
      else waiter.resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<IncomingMessage> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value) return Promise.resolve({ value, done: false });
        if (this.failure) return Promise.reject(this.failure);
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        const waiter = deferred<IteratorResult<IncomingMessage>>();
        this.waiters.push(waiter);
        return waiter.promise;
      },
    };
  }
}

class AppServerConnection {
  readonly messages = new MessageQueue();
  readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private responses = new Map<string, Deferred<unknown>>();
  private stderr = "";

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stderr.on("data", (chunk: Buffer) => {
      if (this.stderr.length < 16_000)
        this.stderr += chunk.toString("utf8").slice(0, 16_000 - this.stderr.length);
    });
    child.once("error", (error) => this.fail(error));
    child.once("close", (code, signal) => {
      const detail = this.stderr.trim();
      this.fail(new Error(detail || `Codex App Server exited (${code ?? signal ?? "unknown"}).`));
    });
    void this.readLines();
  }

  get diagnostic(): string {
    return this.stderr;
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.write({ method, params });
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const key = encodeRequestId(id);
    const response = deferred<unknown>();
    this.responses.set(key, response);
    this.write({ method, id, params });
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        response.promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Codex App Server handshake timed out.")),
            REQUEST_TIMEOUT_MS,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      this.responses.delete(key);
    }
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.write({ id, result });
  }

  respondError(id: JsonRpcId, code: number, message: string): void {
    this.write({ id, error: { code, message } });
  }

  fail(error: Error): void {
    for (const response of this.responses.values()) response.reject(error);
    this.responses.clear();
    this.messages.fail(error);
  }

  private write(message: Record<string, unknown>): void {
    if (this.child.stdin.destroyed || !this.child.stdin.writable) {
      throw new Error("Codex App Server input is closed.");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private async readLines(): Promise<void> {
    try {
      for await (const line of createInterface({ input: this.child.stdout, crlfDelay: Infinity })) {
        if (line.length > MAX_LINE_LENGTH)
          throw new Error("Codex App Server message is too large.");
        const message = parseIncomingMessage(line);
        if (message.type === "response") {
          const key = encodeRequestId(message.id);
          const response = this.responses.get(key);
          if (!response) continue;
          if (message.error)
            response.reject(new Error(message.error.message ?? "Codex request failed."));
          else response.resolve(message.result);
        } else {
          this.messages.push(message);
        }
      }
      this.messages.finish();
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error("Invalid Codex App Server message."));
    }
  }
}

interface PendingApproval {
  wireId: JsonRpcId;
  timer: NodeJS.Timeout;
  /** The refusal the server offered for this request ("decline", or "cancel" when that is the only one). */
  refusal: "decline" | "cancel";
}

/**
 * Servers may list the decisions they accept for a request. When the list is present, only
 * use what it offers; older servers omit it and accept all of them.
 */
function offeredDecisions(params: Record<string, unknown>): {
  canAccept: boolean;
  refusal: "decline" | "cancel";
} {
  const offered = params.availableDecisions;
  if (!Array.isArray(offered)) return { canAccept: true, refusal: "decline" };
  return {
    canAccept: offered.includes("accept"),
    refusal: offered.includes("decline") ? "decline" : "cancel",
  };
}

interface TaskSession {
  connection: AppServerConnection;
  pending: Map<string, PendingApproval>;
  fileChanges: Map<string, Record<string, unknown>>;
  task: AgentTask;
  approvalTimedOut: boolean;
}

interface ProviderOptions {
  executable?: string;
  spawnProcess?: AppServerSpawn;
  requestTimeoutMs?: number;
  approvalTimeoutMs?: number;
  taskTimeoutMs?: number;
}

export class CodexAppServerProvider implements AgentProvider {
  private readonly executable: string;
  private readonly spawnProcess: AppServerSpawn;
  private readonly requestTimeoutMs: number;
  private readonly approvalTimeoutMs: number;
  private readonly taskTimeoutMs: number;
  private sessions = new Map<string, TaskSession>();

  constructor(options: ProviderOptions = {}) {
    this.executable = options.executable ?? "codex";
    this.spawnProcess =
      options.spawnProcess ??
      ((command, args, spawnOptions) =>
        nodeSpawn(command, args, spawnOptions) as ChildProcessWithoutNullStreams);
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS;
    this.taskTimeoutMs = options.taskTimeoutMs ?? TASK_TIMEOUT_MS;
  }

  async *runTask(
    input: AgentTask,
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<AgentEvent> {
    if (input.mode !== "read") {
      yield { type: "error", error: "현재 포코는 승인된 읽기 전용 요청만 처리할 수 있어." };
      return;
    }
    if (options.signal?.aborted) {
      yield { type: "cancelled" };
      return;
    }

    let connection: AppServerConnection;
    try {
      const child = this.spawnProcess(
        this.executable,
        [
          "--strict-config",
          "--config",
          'default_permissions="poko-readonly"',
          "--config",
          'permissions={"poko-readonly"={extends=":read-only",filesystem={":root"="deny",":minimal"="read",":workspace_roots"={"."="read"}},network={enabled=false}}}',
          "--config",
          "mcp_servers={}",
          "app-server",
          "--listen",
          "stdio://",
        ],
        {
          cwd: input.cwd,
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
          windowsHide: true,
        },
      );
      connection = new AppServerConnection(child);
    } catch {
      yield {
        type: "error",
        error: "Codex App Server를 시작하지 못했어. CLI 업데이트를 확인해 줘.",
      };
      return;
    }

    const session: TaskSession = {
      connection,
      pending: new Map(),
      fileChanges: new Map(),
      task: input,
      approvalTimedOut: false,
    };
    this.sessions.set(input.id, session);
    let timeout: NodeJS.Timeout | undefined;
    let aborted = false;
    let finalMessage = "";
    let terminal = false;
    const terminate = (): void => {
      try {
        signalProcess(connection.child, "SIGTERM");
      } catch {
        /* child may already be closed */
      }
    };
    const onAbort = (): void => {
      aborted = true;
      for (const pending of session.pending.values()) {
        clearTimeout(pending.timer);
        try {
          connection.respond(pending.wireId, { decision: "cancel" });
        } catch {
          /* closing */
        }
      }
      session.pending.clear();
      terminate();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(terminate, this.taskTimeoutMs);
    timeout.unref?.();

    try {
      const initialized = await this.withRequestTimeout(
        connection.request("initialize", {
          clientInfo: { name: "poko", title: "Poko", version: "0.1.0" },
          capabilities: {},
        }),
      );
      if (!isRecord(initialized) || typeof initialized.userAgent !== "string") {
        throw new Error("Unsupported Codex App Server initialize response.");
      }
      connection.notify("initialized");
      const threadResult = await this.withRequestTimeout(
        connection.request("thread/start", {
          cwd: input.cwd,
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandbox: "read-only",
          config: {
            default_permissions: "poko-readonly",
            permissions: {
              "poko-readonly": {
                extends: ":read-only",
                filesystem: {
                  ":root": "deny",
                  ":minimal": "read",
                  ":workspace_roots": { ".": "read" },
                },
                network: { enabled: false },
              },
            },
            mcp_servers: {},
          },
        }),
      );
      const threadId =
        isRecord(threadResult) && isRecord(threadResult.thread)
          ? readString(threadResult.thread.id)
          : undefined;
      if (!threadId) throw new Error("Codex App Server did not return a thread id.");

      yield { type: "started" };
      const turnResult = await this.withRequestTimeout(
        connection.request("turn/start", {
          threadId,
          cwd: input.cwd,
          input: [{ type: "text", text: input.prompt }],
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandboxPolicy: { type: "readOnly", networkAccess: false },
        }),
      );
      if (!isRecord(turnResult) || !isRecord(turnResult.turn))
        throw new Error("Codex App Server did not start a turn.");

      for await (const message of connection.messages) {
        if (options.signal?.aborted || aborted) break;
        if (message.type === "request") {
          const event = this.handleServerRequest(session, message);
          if (event) yield event;
          continue;
        }
        if (message.type !== "notification") continue;

        if (message.method === "item/started") {
          const item = message.params.item;
          if (isRecord(item) && item.type === "fileChange" && typeof item.id === "string") {
            session.fileChanges.set(item.id, item);
          } else if (isRecord(item) && item.type === "commandExecution") {
            yield { type: "tool", tool: "terminal", detail: "명령을 확인하고 있어." };
          }
        } else if (message.method === "item/agentMessage/delta") {
          const delta = readString(message.params.delta);
          if (delta) {
            finalMessage += delta;
            const itemId = readString(message.params.itemId);
            yield { type: "output", content: delta, ...(itemId ? { itemId } : {}) };
          }
        } else if (message.method === "item/completed") {
          const item = message.params.item;
          if (isRecord(item) && item.type === "agentMessage" && typeof item.text === "string") {
            finalMessage = item.text;
          }
        } else if (message.method === "turn/completed") {
          const turn = message.params.turn;
          const status = isRecord(turn) ? readString(turn.status) : undefined;
          if (status === "completed") {
            terminal = true;
            yield { type: "completed", result: finalMessage.trim() || "요청한 작업을 마쳤어." };
          } else if (status === "interrupted") {
            terminal = true;
            yield { type: "cancelled" };
          } else {
            terminal = true;
            yield {
              type: "error",
              error: "Codex 작업을 마치지 못했어. 설정을 확인하고 다시 시도해 줘.",
            };
          }
          break;
        } else if (message.method === "error") {
          // Transient failures (e.g. a dropped model stream) are retried by Codex itself.
          if (message.params.willRetry === true) continue;
          terminal = true;
          yield { type: "error", error: "Codex App Server에서 오류가 발생했어. 다시 시도해 줘." };
          break;
        }
      }

      if (!terminal && (options.signal?.aborted || aborted)) {
        yield { type: "cancelled" };
      } else if (!terminal) {
        throw new Error("Codex App Server stream ended early.");
      }
    } catch (error) {
      if (options.signal?.aborted || aborted) yield { type: "cancelled" };
      else if (session.approvalTimedOut) {
        yield { type: "error", error: "확인을 오래 기다려서 작업을 멈췄어. 다시 요청해 줘." };
      } else if (error instanceof ProviderFailure) yield { type: "error", error: error.message };
      else yield { type: "error", error: this.friendlyError(error, connection.diagnostic) };
    } finally {
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      for (const pending of session.pending.values()) clearTimeout(pending.timer);
      session.pending.clear();
      this.sessions.delete(input.id);
      terminate();
    }
  }

  hasPendingApproval(taskId: string, requestId: string): boolean {
    return this.sessions.get(taskId)?.pending.has(requestId) ?? false;
  }

  respondToApproval(taskId: string, requestId: string, choice: ApprovalChoice): boolean {
    const session = this.sessions.get(taskId);
    const pending = session?.pending.get(requestId);
    if (!session || !pending) return false;
    // One-shot: the request is consumed even if writing the reply fails.
    session.pending.delete(requestId);
    clearTimeout(pending.timer);
    try {
      // Only the single-request decisions are ever sent; session-wide trust is never granted.
      session.connection.respond(pending.wireId, {
        decision: choice === "approve" ? "accept" : pending.refusal,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async withRequestTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Codex App Server did not respond in time.")),
            this.requestTimeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private handleServerRequest(
    session: TaskSession,
    message: Extract<IncomingMessage, { type: "request" }>,
  ): AgentEvent | null {
    if (!APPROVAL_METHODS.has(message.method)) {
      try {
        session.connection.respondError(message.id, -32601, "Unsupported request.");
      } catch {
        /* the connection is failing below */
      }
      throw new ProviderFailure("지원하지 않는 요청이 와서 작업을 멈췄어.");
    }

    const requestId = encodeRequestId(message.id);
    if (session.pending.has(requestId)) {
      throw new ProviderFailure("같은 확인 요청이 두 번 와서 작업을 멈췄어.");
    }
    const event =
      message.method === "item/commandExecution/requestApproval"
        ? this.describeCommandApproval(session, requestId, message.params)
        : this.describeFileChangeApproval(session, requestId, message.params);

    const offered = offeredDecisions(message.params);
    if (!offered.canAccept) event.canApprove = false;
    if (!event.canApprove) {
      try {
        session.connection.respond(message.id, { decision: offered.refusal });
      } catch {
        throw new ProviderFailure("확인 요청을 안전하게 거절하지 못해 작업을 멈췄어.");
      }
      return event;
    }

    const timer = setTimeout(() => {
      if (!session.pending.delete(requestId)) return;
      session.approvalTimedOut = true;
      try {
        session.connection.respond(message.id, { decision: "cancel" });
      } catch {
        /* the child is terminated next */
      }
      signalProcess(session.connection.child, "SIGTERM");
    }, this.approvalTimeoutMs);
    timer.unref?.();
    session.pending.set(requestId, { wireId: message.id, timer, refusal: offered.refusal });
    return event;
  }

  private describeCommandApproval(
    session: TaskSession,
    requestId: string,
    params: Record<string, unknown>,
  ): ApprovalEvent {
    const command = readString(params.command)?.trim();
    const cwd = readString(params.cwd) ?? null;
    // Older servers omit `kind`; the protocol default is "command".
    const kind = params.kind ?? "command";
    // Network access stays unavailable. An execpolicy amendment is only a proposal: it takes
    // effect solely through "acceptWithExecpolicyAmendment", which Poko never sends, so its
    // presence (Codex attaches one to most requests) does not broaden anything.
    const needsNetwork =
      params.networkApprovalContext != null || params.proposedNetworkPolicyAmendments != null;
    const canApprove =
      kind === "command" &&
      Boolean(command && command.length <= 8_000) &&
      Boolean(cwd && isInside(session.task.cwd, cwd)) &&
      !needsNetwork;
    return {
      type: "approvalRequired",
      requestId,
      kind: "command",
      summary: command || "명령 내용을 확인할 수 없어.",
      cwd,
      reason: readString(params.reason) ?? null,
      canApprove,
    };
  }

  private describeFileChangeApproval(
    session: TaskSession,
    requestId: string,
    params: Record<string, unknown>,
  ): ApprovalEvent {
    const itemId = readString(params.itemId);
    const item = itemId ? session.fileChanges.get(itemId) : undefined;
    const changes = item ? getFileChanges(item, session.task.cwd) : null;
    const grantRoot = readString(params.grantRoot);
    const canApprove = Boolean(changes?.length) && !grantRoot;
    return {
      type: "approvalRequired",
      requestId,
      kind: "file_change",
      summary: changes?.length
        ? `${changes.length}개 파일 변경을 적용하려고 해.`
        : "변경 내용을 확인할 수 없어.",
      cwd: session.task.cwd,
      reason:
        readString(params.reason) ?? (grantRoot ? "선택한 폴더 밖의 쓰기 권한이 필요해." : null),
      ...(changes ? { diff: changes } : {}),
      canApprove,
    };
  }

  private friendlyError(error: unknown, stderr: string): string {
    const detail = `${error instanceof Error ? error.message : ""}\n${stderr}`.toLowerCase();
    if (/not logged in|please log in|authentication|unauthorized|invalid_grant/.test(detail)) {
      return "Codex 로그인이 필요해. 터미널에서 Codex 로그인을 완료해 줘.";
    }
    if (/no such file|enoent/.test(detail))
      return "Codex를 찾지 못했어. Codex CLI 설치를 확인해 줘.";
    if (/permission|sandbox|unknown config|mcp_servers/.test(detail)) {
      return "Codex App Server가 포코의 제한 설정을 지원하지 않아. Codex CLI를 업데이트해 줘.";
    }
    if (/timed out|in time/.test(detail)) return "Codex 응답이 늦어 작업을 멈췄어. 다시 시도해 줘.";
    return "작업을 마치지 못했어. Codex CLI 설정을 확인해 줘.";
  }
}

type ApprovalEvent = Extract<AgentEvent, { type: "approvalRequired" }>;

/** Returns null unless every change is well-formed and stays inside the workspace. */
export function getFileChanges(
  item: Record<string, unknown>,
  root: string,
): Array<{ path: string; change: string }> | null {
  if (!Array.isArray(item.changes) || item.changes.length === 0) return null;
  const changes: Array<{ path: string; change: string }> = [];
  let totalLength = 0;
  for (const value of item.changes) {
    if (
      !isRecord(value) ||
      typeof value.path !== "string" ||
      !isRecord(value.kind) ||
      typeof value.diff !== "string"
    )
      return null;
    totalLength += value.diff.length;
    if (totalLength > MAX_DIFF_LENGTH || value.path.length > 1000) return null;
    const kind = readString(value.kind.type);
    if (!kind || !["add", "update", "delete"].includes(kind)) return null;
    if (!isInside(root, resolve(root, value.path))) return null;
    const movePath = value.kind.move_path;
    if (
      movePath != null &&
      (typeof movePath !== "string" || !isInside(root, resolve(root, movePath)))
    )
      return null;
    changes.push({ path: value.path, change: `${kind}:\n${value.diff}` });
  }
  return changes;
}

export function isInside(root: string, target: string): boolean {
  if (!isAbsolute(target)) return false;
  const realRoot = realPath(resolve(root));
  const realTarget = realPath(resolve(target));
  if (!realRoot || !realTarget) return false;
  const path = relative(realRoot, realTarget);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/**
 * Resolves symlinks through the nearest existing ancestor so a path that does not exist yet
 * cannot escape the workspace via a linked directory. Returns null for a dangling link.
 */
function realPath(path: string): string | null {
  const missing: string[] = [];
  let current = path;
  for (;;) {
    try {
      return join(realpathSync.native(current), ...missing);
    } catch {
      try {
        lstatSync(current);
        return null;
      } catch {
        /* does not exist yet; check its parent */
      }
      const parent = dirname(current);
      if (parent === current) return null;
      missing.unshift(basename(current));
      current = parent;
    }
  }
}
