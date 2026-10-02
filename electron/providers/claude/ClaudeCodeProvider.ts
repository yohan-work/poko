import { type ChildProcessWithoutNullStreams, spawn, type SpawnOptions } from "node:child_process";
import { relative } from "node:path";
import type { AgentProvider } from "../../agent/AgentProvider";
import {
  type AgentEvent,
  type AgentTask,
  type ApprovalChoice,
  isUnavailableModelError,
} from "../../shared";
import { type PlannedEdit, planEdit } from "./claudeEdits";
import { signalProcess } from "../codex/CodexProvider";

const MAX_LINE_LENGTH = 4 * 1024 * 1024;
const TASK_TIMEOUT_MS = 10 * 60 * 1000;
const INTERRUPT_GRACE_MS = 1500;
const KILL_GRACE_MS = 3000;

/** Tools a task may ever see. Shell, web, and agents are never offered. */
export const READ_TOOLS = ["Read", "Grep", "Glob"] as const;
/** Offered only when the user allowed edits; each call becomes an approval card. */
export const EDIT_TOOLS = ["Edit", "Write"] as const;
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

/** Claude Code's model aliases; each always points at the latest model of its kind. */
export const CLAUDE_MODELS = [
  { id: "fable", label: "Fable" },
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
] as const;

export interface ClaudeRuntime {
  executable: string;
  environment: NodeJS.ProcessEnv;
}

export type ClaudeSpawn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams;

interface PendingEdit {
  toolName: string;
  input: Record<string, unknown>;
  plan: PlannedEdit;
  timer: NodeJS.Timeout;
}

interface TaskSession {
  cwd: string;
  pending: Map<string, PendingEdit>;
  respond: (requestId: string, response: Record<string, unknown>) => void;
  /** Ends the task's process. */
  stop: () => void;
  approvalTimedOut: boolean;
}

interface ProviderOptions {
  approvalTimeoutMs?: number;
  runtime?: () => ClaudeRuntime;
  spawnProcess?: ClaudeSpawn;
  taskTimeoutMs?: number;
  interruptGraceMs?: number;
}

/**
 * The CLI arguments for a task. Settings files are not loaded (`--setting-sources ""`), so no
 * user or project rule can allow a tool or change the permission mode; `--safe-mode` turns off
 * hooks, plugins, skills, MCP servers, and CLAUDE.md. Every permission prompt comes to Poko.
 */
export function claudeArgs(tools: readonly string[], model?: string): string[] {
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-prompt-tool",
    "stdio",
    "--permission-mode",
    "default",
    "--setting-sources",
    "",
    "--safe-mode",
    "--strict-mcp-config",
    "--no-session-persistence",
    ...(model ? ["--model", model] : []),
    "--tools",
    tools.join(","),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A short, plain description of a tool call for Activity; paths are shown relative. */
export function toolDetail(name: string, input: unknown, cwd: string): string {
  const fields = isRecord(input) ? input : {};
  const path = readString(fields.file_path) ?? readString(fields.path);
  const shown = path ? relative(cwd, path) || "." : undefined;
  if (name === "Read") return shown ? `${shown} 파일을 읽고 있어.` : "파일을 읽고 있어.";
  if (name === "Grep") return "프로젝트에서 찾고 있어.";
  if (name === "Glob") return "파일 목록을 살펴보고 있어.";
  return "프로젝트를 살펴보고 있어.";
}

class LineQueue implements AsyncIterable<unknown> {
  private items: unknown[] = [];
  private waiting: {
    resolve: (result: IteratorResult<unknown>) => void;
    reject: (error: Error) => void;
  } | null = null;
  private failure: Error | null = null;
  private done = false;

  push(value: unknown): void {
    // Nothing after a failure counts, even a result line in the same chunk.
    if (this.done) return;
    if (this.waiting) {
      const { resolve } = this.waiting;
      this.waiting = null;
      resolve({ value, done: false });
    } else this.items.push(value);
  }

  /** Ends the queue with an error; a reader waiting right now gets it too. */
  fail(error: Error): void {
    if (this.done) return;
    this.failure = error;
    this.done = true;
    if (this.waiting) {
      const { reject } = this.waiting;
      this.waiting = null;
      reject(error);
    }
  }

  finish(): void {
    if (this.done) return;
    this.done = true;
    if (this.waiting) {
      const { resolve } = this.waiting;
      this.waiting = null;
      resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return {
      next: () => {
        if (this.items.length > 0)
          return Promise.resolve({ value: this.items.shift(), done: false });
        if (this.failure) return Promise.reject(this.failure);
        if (this.done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => {
          this.waiting = { resolve, reject };
        });
      },
    };
  }
}

class ClaudeFailure extends Error {}

/**
 * Runs a task with the user's own Claude Code CLI over stream-json. Main process only. Raw CLI
 * output never leaves this class: it becomes AgentEvent values.
 */
export class ClaudeCodeProvider implements AgentProvider {
  private readonly runtime: () => ClaudeRuntime;
  private readonly spawnProcess: ClaudeSpawn;
  private readonly taskTimeoutMs: number;
  private readonly interruptGraceMs: number;
  private readonly approvalTimeoutMs: number;
  private readonly sessions = new Map<string, TaskSession>();

  constructor(options: ProviderOptions = {}) {
    this.runtime = options.runtime ?? (() => ({ executable: "claude", environment: process.env }));
    this.spawnProcess =
      options.spawnProcess ??
      ((command, args, spawnOptions) =>
        spawn(command, args, spawnOptions) as ChildProcessWithoutNullStreams);
    this.taskTimeoutMs = options.taskTimeoutMs ?? TASK_TIMEOUT_MS;
    this.interruptGraceMs = options.interruptGraceMs ?? INTERRUPT_GRACE_MS;
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS;
  }

  hasPendingApproval(taskId: string, requestId: string): boolean {
    return this.sessions.get(taskId)?.pending.has(requestId) ?? false;
  }

  /** Recomputes the change from the current disk; it must be exactly what the card showed. */
  canStillApprove(taskId: string, requestId: string): boolean {
    const session = this.sessions.get(taskId);
    const pending = session?.pending.get(requestId);
    if (!session || !pending) return false;
    const again = planEdit(session.cwd, pending.toolName, pending.input);
    return (
      !("refusal" in again) &&
      again.path === pending.plan.path &&
      again.before === pending.plan.before &&
      again.after === pending.plan.after
    );
  }

  fileChangePaths(taskId: string, requestId: string): string[] | null {
    const pending = this.sessions.get(taskId)?.pending.get(requestId);
    return pending ? [pending.plan.path] : null;
  }

  respondToApproval(taskId: string, requestId: string, choice: ApprovalChoice): boolean {
    const session = this.sessions.get(taskId);
    const pending = session?.pending.get(requestId);
    if (!session || !pending) return false;
    // One-shot: the request is consumed even if writing the reply fails.
    session.pending.delete(requestId);
    clearTimeout(pending.timer);
    try {
      session.respond(
        requestId,
        choice === "approve"
          ? { behavior: "allow", updatedInput: pending.input }
          : { behavior: "deny", message: "The user declined this change." },
      );
      return true;
    } catch {
      return false;
    }
  }

  async *runTask(
    input: AgentTask,
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<AgentEvent> {
    if (input.mode !== "read" || input.profile === "screen") {
      yield { type: "error", error: "Claude Code로는 이 작업을 할 수 없어." };
      return;
    }
    if (options.signal?.aborted) {
      yield { type: "cancelled" };
      return;
    }

    const tools: readonly string[] = input.editsEnabled
      ? [...READ_TOOLS, ...EDIT_TOOLS]
      : READ_TOOLS;
    const runtime = this.runtime();
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnProcess(runtime.executable, claudeArgs(tools, input.model), {
        cwd: input.cwd,
        env: runtime.environment,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    } catch {
      yield { type: "error", error: "Claude Code를 시작하지 못했어. 설치를 확인해 줘." };
      return;
    }

    const lines = new LineQueue();
    let stderr = "";
    let buffer = "";
    child.stdout.setEncoding("utf8");
    let broken = false;
    child.stdout.on("data", (chunk: string) => {
      if (broken) return;
      buffer += chunk;
      if (buffer.length > MAX_LINE_LENGTH) {
        broken = true;
        buffer = "";
        lines.fail(new ClaudeFailure("Claude Code 응답이 너무 길어서 작업을 멈췄어."));
        return;
      }
      for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try {
          lines.push(JSON.parse(line));
        } catch {
          broken = true;
          buffer = "";
          lines.fail(new ClaudeFailure("Claude Code가 읽을 수 없는 응답을 보냈어."));
          return;
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.on("error", (error) => lines.fail(error));
    child.on("close", () => lines.finish());
    child.stdin.on("error", () => undefined);

    const write = (message: Record<string, unknown>): void => {
      if (!child.stdin.writable) return;
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    let closed = false;
    child.once("close", () => {
      closed = true;
    });
    const terminate = (): void => {
      if (closed) return;
      try {
        signalProcess(child, "SIGTERM");
      } catch {
        /* already closed */
      }
      // A CLI that ignores SIGTERM must not outlive its task.
      const kill = setTimeout(() => {
        if (closed) return;
        try {
          signalProcess(child, "SIGKILL");
        } catch {
          /* already closed */
        }
      }, KILL_GRACE_MS);
      kill.unref?.();
    };

    const respond = (requestId: string, response: Record<string, unknown>): void => {
      if (!child.stdin.writable) throw new Error("Claude Code is not listening.");
      write({
        type: "control_response",
        response: { subtype: "success", request_id: requestId, response },
      });
    };
    const session: TaskSession = {
      cwd: input.cwd,
      pending: new Map(),
      respond,
      stop: () => terminate(),
      approvalTimedOut: false,
    };
    this.sessions.set(input.id, session);
    const declineAll = (message: string): void => {
      for (const [requestId, pending] of session.pending) {
        clearTimeout(pending.timer);
        try {
          respond(requestId, { behavior: "deny", message });
        } catch {
          /* closing */
        }
      }
      session.pending.clear();
    };

    let aborted = false;
    let graceTimer: NodeJS.Timeout | undefined;
    const onAbort = (): void => {
      aborted = true;
      declineAll("The task was cancelled.");
      write({
        type: "control_request",
        request_id: "poko-interrupt",
        request: { subtype: "interrupt" },
      });
      graceTimer = setTimeout(terminate, this.interruptGraceMs);
      graceTimer.unref?.();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(terminate, this.taskTimeoutMs);
    timeout.unref?.();

    let terminal = false;
    let finalText = "";
    let messageId: string | undefined;
    let messageText = "";
    try {
      write({
        type: "control_request",
        request_id: "poko-init",
        request: { subtype: "initialize" },
      });
      write({ type: "user", message: { role: "user", content: input.prompt } });

      for await (const raw of lines) {
        if (!isRecord(raw)) continue;
        const type = readString(raw.type);

        if (type === "system" && raw.subtype === "init") {
          // Refuse to go on if anything widened what the CLI may do on its own.
          const reported = Array.isArray(raw.tools) ? raw.tools : [];
          const extra = reported.some((tool) => typeof tool !== "string" || !tools.includes(tool));
          if (raw.permissionMode !== "default" || extra)
            throw new ClaudeFailure("Claude Code가 포코의 제한 설정대로 시작하지 않아서 멈췄어.");
          yield { type: "started" };
          continue;
        }

        if (type === "control_request") {
          const requestId = readString(raw.request_id);
          const request = isRecord(raw.request) ? raw.request : {};
          if (!requestId) continue;
          if (request.subtype === "can_use_tool") {
            const event = this.handlePermission(session, input, requestId, request);
            if (event) yield event;
          } else {
            write({
              type: "control_response",
              response: { subtype: "error", request_id: requestId, error: "Not supported." },
            });
          }
          continue;
        }

        if (type === "stream_event" && isRecord(raw.event)) {
          const event = raw.event;
          if (event.type === "message_start" && isRecord(event.message)) {
            messageId = readString(event.message.id);
            messageText = "";
          } else if (event.type === "content_block_start" && isRecord(event.content_block)) {
            if (event.content_block.type === "thinking") yield { type: "thinking" };
          } else if (event.type === "content_block_delta" && isRecord(event.delta)) {
            const text = event.delta.type === "text_delta" ? readString(event.delta.text) : "";
            if (text) {
              messageText += text;
              finalText = messageText;
              yield { type: "output", content: text, ...(messageId ? { itemId: messageId } : {}) };
            }
          }
          continue;
        }

        if (type === "assistant" && isRecord(raw.message) && Array.isArray(raw.message.content)) {
          for (const block of raw.message.content) {
            if (isRecord(block) && block.type === "tool_use") {
              const name = readString(block.name) ?? "tool";
              yield { type: "tool", tool: name, detail: toolDetail(name, block.input, input.cwd) };
            }
          }
          continue;
        }

        if (type === "result") {
          terminal = true;
          if (aborted) yield { type: "cancelled" };
          else if (session.approvalTimedOut)
            yield { type: "error", error: "확인을 오래 기다려서 작업을 멈췄어. 다시 요청해 줘." };
          else if (raw.subtype === "success" && raw.is_error !== true) {
            const result = readString(raw.result)?.trim() || finalText.trim();
            yield { type: "completed", result: result || "요청한 작업을 마쳤어." };
          } else
            yield {
              type: "error",
              error: this.friendlyError(readString(raw.result) ?? "", stderr, Boolean(input.model)),
            };
          break;
        }
      }

      if (!terminal) {
        if (aborted || options.signal?.aborted) yield { type: "cancelled" };
        else if (session.approvalTimedOut)
          yield { type: "error", error: "확인을 오래 기다려서 작업을 멈췄어. 다시 요청해 줘." };
        else yield { type: "error", error: this.friendlyError("", stderr, Boolean(input.model)) };
      }
    } catch (error) {
      if (aborted || options.signal?.aborted) yield { type: "cancelled" };
      else if (error instanceof ClaudeFailure) yield { type: "error", error: error.message };
      else
        yield {
          type: "error",
          error: this.friendlyError(String(error), stderr, Boolean(input.model)),
        };
    } finally {
      declineAll("The task ended.");
      this.sessions.delete(input.id);
      clearTimeout(timeout);
      if (graceTimer) clearTimeout(graceTimer);
      options.signal?.removeEventListener("abort", onAbort);
      try {
        child.stdin.end();
      } catch {
        /* closed */
      }
      terminate();
    }
  }

  /**
   * Decides a permission request. Only Edit and Write inside the workspace, with edits on,
   * become an approval card; everything else is denied at once.
   */
  private handlePermission(
    session: TaskSession,
    task: AgentTask,
    requestId: string,
    request: Record<string, unknown>,
  ): AgentEvent | null {
    const toolName = readString(request.tool_name) ?? "";
    const input = isRecord(request.input) ? request.input : {};
    const deny = (message: string) => {
      session.respond(requestId, { behavior: "deny", message });
    };
    if (session.pending.has(requestId)) {
      deny("Duplicate request.");
      return null;
    }
    if (!(EDIT_TOOLS as readonly string[]).includes(toolName) || !task.editsEnabled) {
      deny("Poko only allows reading files inside the selected workspace. Do not retry.");
      return {
        type: "tool",
        tool: "permission",
        detail: "작업 폴더 밖이나 허용되지 않은 동작이라 건너뛰었어.",
      };
    }
    const plan = planEdit(session.cwd, toolName, input);
    if ("refusal" in plan) {
      deny(`Poko refused this change: ${plan.refusal} Do not retry it.`);
      return {
        type: "approvalRequired",
        requestId,
        kind: "file_change",
        summary: "파일 변경 요청을 거절했어.",
        cwd: session.cwd,
        reason: plan.refusal,
        canApprove: false,
      };
    }
    const timer = setTimeout(() => {
      if (!session.pending.delete(requestId)) return;
      // Like Codex: nobody is there to answer, so the task stops instead of asking again.
      session.approvalTimedOut = true;
      try {
        deny("The user did not answer in time. Do not retry.");
      } catch {
        /* closing */
      }
      session.stop();
    }, this.approvalTimeoutMs);
    timer.unref?.();
    session.pending.set(requestId, { toolName, input, plan, timer });
    return {
      type: "approvalRequired",
      requestId,
      kind: "file_change",
      summary: "1개 파일 변경을 적용하려고 해.",
      cwd: session.cwd,
      reason: null,
      diff: [{ path: plan.path, change: plan.change }],
      canApprove: true,
    };
  }

  private friendlyError(result: string, stderr: string, picked = false): string {
    const detail = `${result}\n${stderr}`.toLowerCase();
    if (/not logged in|log in|login|authentication|unauthorized|401/.test(detail))
      return "Claude Code 로그인이 필요해. 터미널에서 claude를 실행해 로그인해 줘.";
    // Only a model the user picked can be the problem; the default is the CLI's own choice.
    if (picked && isUnavailableModelError(detail))
      return "이 모델은 지금 계정에서 쓸 수 없어. 입력창 아래에서 모델을 기본값으로 바꿔 줘.";
    if (/enoent|command not found|no such file/.test(detail))
      return "Claude Code를 찾지 못했어. 설치를 확인해 줘.";
    if (/rate limit|usage limit|429/.test(detail))
      return "Claude Code 사용 한도에 닿았어. 잠시 뒤 다시 시도해 줘.";
    if (/unknown option|unrecognized/.test(detail))
      return "Claude Code가 너무 오래된 버전이야. 업데이트해 줘.";
    return "Claude Code 작업을 마치지 못했어. 다시 시도해 줘.";
  }
}
