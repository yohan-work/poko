import { type ChildProcessWithoutNullStreams, spawn, type SpawnOptions } from "node:child_process";
import { relative } from "node:path";
import type { AgentProvider } from "../../agent/AgentProvider";
import type { AgentEvent, AgentTask } from "../../shared";
import { signalProcess } from "../codex/CodexProvider";

const MAX_LINE_LENGTH = 4 * 1024 * 1024;
const TASK_TIMEOUT_MS = 10 * 60 * 1000;
const INTERRUPT_GRACE_MS = 1500;
const KILL_GRACE_MS = 3000;

/** Tools a task may ever see. Shell, web, and agents are never offered. */
export const READ_TOOLS = ["Read", "Grep", "Glob"] as const;

export interface ClaudeRuntime {
  executable: string;
  environment: NodeJS.ProcessEnv;
}

export type ClaudeSpawn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams;

interface ProviderOptions {
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
export function claudeArgs(tools: readonly string[]): string[] {
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
 * The prompt as sent. Edits through approvals aren't offered on this engine yet, so a request
 * that needs a change is answered with a description instead of a tool Claude doesn't have.
 */
export function promptFor(input: AgentTask): string {
  if (!input.editsEnabled) return input.prompt;
  return `${input.prompt}\n\nNote for this engine: Poko can't apply file changes with Claude Code yet, even though edits are allowed. Describe the exact change (file and lines) instead of calling a tool, and say the user can switch the engine to Codex in 설정 to apply it.`;
}

/**
 * Runs a task with the user's own Claude Code CLI over stream-json. Main process only. Raw CLI
 * output never leaves this class: it becomes AgentEvent values.
 */
export class ClaudeCodeProvider implements AgentProvider {
  private readonly runtime: () => ClaudeRuntime;
  private readonly spawnProcess: ClaudeSpawn;
  private readonly taskTimeoutMs: number;
  private readonly interruptGraceMs: number;

  constructor(options: ProviderOptions = {}) {
    this.runtime = options.runtime ?? (() => ({ executable: "claude", environment: process.env }));
    this.spawnProcess =
      options.spawnProcess ??
      ((command, args, spawnOptions) =>
        spawn(command, args, spawnOptions) as ChildProcessWithoutNullStreams);
    this.taskTimeoutMs = options.taskTimeoutMs ?? TASK_TIMEOUT_MS;
    this.interruptGraceMs = options.interruptGraceMs ?? INTERRUPT_GRACE_MS;
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

    const tools = READ_TOOLS;
    const runtime = this.runtime();
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnProcess(runtime.executable, claudeArgs(tools), {
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
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE_LENGTH) {
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
          lines.fail(new ClaudeFailure("Claude Code가 읽을 수 없는 응답을 보냈어."));
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

    let aborted = false;
    let graceTimer: NodeJS.Timeout | undefined;
    const onAbort = (): void => {
      aborted = true;
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
      write({ type: "user", message: { role: "user", content: promptFor(input) } });

      for await (const raw of lines) {
        if (!isRecord(raw)) continue;
        const type = readString(raw.type);

        if (type === "system" && raw.subtype === "init") {
          // Refuse to go on if anything widened what the CLI may do on its own.
          const reported = Array.isArray(raw.tools) ? raw.tools : [];
          const extra = reported.some(
            (tool) => typeof tool !== "string" || !(tools as readonly string[]).includes(tool),
          );
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
            // Milestone 1 is read-only: anything that needs permission is declined.
            write({
              type: "control_response",
              response: {
                subtype: "success",
                request_id: requestId,
                response: {
                  behavior: "deny",
                  message:
                    "Poko only allows reading files inside the selected workspace. Do not retry.",
                },
              },
            });
            yield {
              type: "tool",
              tool: "permission",
              detail: "작업 폴더 밖이나 허용되지 않은 동작이라 건너뛰었어.",
            };
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
          else if (raw.subtype === "success" && raw.is_error !== true) {
            const result = readString(raw.result)?.trim() || finalText.trim();
            yield { type: "completed", result: result || "요청한 작업을 마쳤어." };
          } else
            yield {
              type: "error",
              error: this.friendlyError(readString(raw.result) ?? "", stderr),
            };
          break;
        }
      }

      if (!terminal) {
        if (aborted || options.signal?.aborted) yield { type: "cancelled" };
        else yield { type: "error", error: this.friendlyError("", stderr) };
      }
    } catch (error) {
      if (aborted || options.signal?.aborted) yield { type: "cancelled" };
      else if (error instanceof ClaudeFailure) yield { type: "error", error: error.message };
      else yield { type: "error", error: this.friendlyError(String(error), stderr) };
    } finally {
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

  private friendlyError(result: string, stderr: string): string {
    const detail = `${result}\n${stderr}`.toLowerCase();
    if (/not logged in|log in|login|authentication|unauthorized|401/.test(detail))
      return "Claude Code 로그인이 필요해. 터미널에서 claude를 실행해 로그인해 줘.";
    if (/enoent|not found/.test(detail)) return "Claude Code를 찾지 못했어. 설치를 확인해 줘.";
    if (/rate limit|usage limit|429/.test(detail))
      return "Claude Code 사용 한도에 닿았어. 잠시 뒤 다시 시도해 줘.";
    if (/unknown option|unrecognized/.test(detail))
      return "Claude Code가 너무 오래된 버전이야. 업데이트해 줘.";
    return "Claude Code 작업을 마치지 못했어. 다시 시도해 줘.";
  }
}
