import {
  spawn as nodeSpawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
} from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import type { AgentEvent, AgentTask } from "../../shared";
import type { AgentProvider } from "../../agent/AgentProvider";
import { parseCodexJsonlLine, type CodexRecord } from "./jsonl";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_JSONL_LINE_LENGTH = 1024 * 1024;
const MAX_STDERR_LENGTH = 16 * 1024;

export type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams;

interface CodexProviderOptions {
  executable?: string;
  /** The environment to start Codex with (see codexEnvironment). */
  environment?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  spawnProcess?: SpawnProcess;
}

export function resolveCodexExecutable(environmentPath = process.env.PATH ?? ""): Promise<string> {
  return resolveCliExecutable("codex", [join(homedir(), ".codex", "bin")], environmentPath);
}

/**
 * Finds a CLI on the PATH or in the places installers put it (an app opened from Finder gets a
 * minimal PATH). Returns the bare name when nothing is found, so spawn applies PATH rules.
 */
export async function resolveCliExecutable(
  name: string,
  extraFolders: string[] = [],
  environmentPath = process.env.PATH ?? "",
): Promise<string> {
  const executableName = process.platform === "win32" ? `${name}.exe` : name;
  const candidates = [
    ...environmentPath
      .split(delimiter)
      .filter(Boolean)
      .map((directory) => join(directory, executableName)),
    join(homedir(), ".local", "bin", executableName),
    join(homedir(), ".npm-global", "bin", executableName),
    ...extraFolders.map((folder) => join(folder, executableName)),
    join(homedir(), ".volta", "bin", executableName),
    join(homedir(), ".asdf", "shims", executableName),
    join(homedir(), ".bun", "bin", executableName),
    ...(process.platform === "darwin"
      ? [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]
      : []),
    ...(process.platform === "linux" ? [`/usr/local/bin/${name}`, `/usr/bin/${name}`] : []),
  ];

  const nvmDirectory = join(homedir(), ".nvm", "versions", "node");
  const nvmVersions = await readdir(nvmDirectory).catch(() => []);
  candidates.push(
    ...nvmVersions
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .map((version) => join(nvmDirectory, version, "bin", executableName)),
  );

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known PATH location.
    }
  }

  // Keep the standard command name so spawn can apply the platform PATH rules.
  return name;
}

function friendlyFailure(error: unknown, stderr: string): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return "Codex를 찾지 못했어. Codex CLI 설치를 확인해 줘.";

  const detail = `${error instanceof Error ? error.message : ""}\n${stderr}`.toLowerCase();
  if (/not logged in|please log in|authentication|unauthorized|invalid_grant/.test(detail)) {
    return "Codex 로그인이 필요해. 터미널에서 Codex 로그인을 완료해 줘.";
  }
  if (/permission profile|default_permissions|sandbox_mode|unknown config/.test(detail)) {
    return "현재 Codex CLI가 포코의 제한형 읽기 권한을 지원하지 않아. Codex CLI를 업데이트해 줘.";
  }
  if (/approval|required permission|needs approval/.test(detail)) {
    return "이 요청은 허용된 폴더 밖의 접근이 필요해서 멈췄어.";
  }
  if (/올바르지 않은 jsonl|이벤트 형식을 읽을 수 없어/.test(detail)) {
    return "Codex 응답을 읽지 못했어. 다시 시도해 줘.";
  }
  return "작업을 마치지 못했어. Codex CLI 설정을 확인해 줘.";
}

function normalizeRecord(record: CodexRecord): AgentEvent | null {
  switch (record.type) {
    case "started":
      return null;
    case "thinking":
      return { type: "thinking", message: "요청을 살펴보고 있어." };
    case "tool":
      return { type: "tool", tool: record.tool, detail: record.detail };
    case "output":
      return { type: "output", content: record.content };
    case "turn_completed":
    case "turn_failed":
    case "error":
      return null;
  }
}

export class CodexProvider implements AgentProvider {
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly spawnProcess: SpawnProcess;
  private readonly environment: NodeJS.ProcessEnv;

  constructor(options: CodexProviderOptions = {}) {
    this.executable = options.executable ?? "codex";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.environment = options.environment ?? process.env;
    this.spawnProcess =
      options.spawnProcess ??
      ((command, args, spawnOptions) =>
        nodeSpawn(command, args, spawnOptions) as ChildProcessWithoutNullStreams);
  }

  async *runTask(
    input: AgentTask,
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<AgentEvent> {
    if (input.mode !== "read") {
      yield { type: "error", error: "현재 포코는 읽기 전용 작업만 할 수 있어." };
      return;
    }

    if (options.signal?.aborted) {
      yield { type: "cancelled" };
      return;
    }

    yield { type: "started" };

    const args = [
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
      input.cwd,
      "-",
    ];

    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnProcess(this.executable, args, {
        cwd: input.cwd,
        env: this.environment,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    } catch (error) {
      yield { type: "error", error: friendlyFailure(error, "") };
      return;
    }

    let stderr = "";
    let spawnError: Error | null = null;
    let timedOut = false;
    let turnCompleted = false;
    let turnFailure: string | null = null;
    let finalOutput = "";
    let malformedOutput = false;
    let closeCode: number | null = null;
    let closeSignal: NodeJS.Signals | null = null;
    let terminationSent = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const closed = new Promise<void>((resolve) => {
      child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
        closeCode = code;
        closeSignal = signal;
        resolve();
      });
    });

    const terminate = (): void => {
      if (terminationSent) return;
      terminationSent = true;
      signalProcess(child, "SIGTERM");
      forceKillTimer = setTimeout(() => signalProcess(child, "SIGKILL"), 1500);
      forceKillTimer.unref?.();
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, this.timeoutMs);
    timeout.unref?.();

    const onAbort = (): void => terminate();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error: Error) => {
      spawnError = error;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_LENGTH) {
        stderr += chunk.toString("utf8").slice(0, MAX_STDERR_LENGTH - stderr.length);
      }
    });

    try {
      child.stdin.end(input.prompt);

      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
      for await (const line of lines) {
        if (line.length > MAX_JSONL_LINE_LENGTH) {
          malformedOutput = true;
          terminate();
          break;
        }

        let records: CodexRecord[];
        try {
          records = parseCodexJsonlLine(line);
        } catch {
          malformedOutput = true;
          terminate();
          break;
        }

        for (const record of records) {
          if (record.type === "turn_completed") turnCompleted = true;
          if (record.type === "turn_failed" || record.type === "error")
            turnFailure = record.message;
          if (record.type === "output") finalOutput = record.content;
          const event = normalizeRecord(record);
          if (event) yield event;
        }
      }

      await closed;
    } catch (error) {
      spawnError ??= error instanceof Error ? error : new Error("Codex process failed.");
      terminate();
      await closed;
    } finally {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      options.signal?.removeEventListener("abort", onAbort);
    }

    if (options.signal?.aborted) {
      yield { type: "cancelled" };
      return;
    }
    if (timedOut) {
      yield { type: "error", error: "작업이 오래 걸려서 멈췄어. 나눠서 다시 부탁해 줘." };
      return;
    }
    if (malformedOutput) {
      yield { type: "error", error: "Codex 응답을 읽지 못했어. 다시 시도해 줘." };
      return;
    }
    if (spawnError) {
      yield { type: "error", error: friendlyFailure(spawnError, stderr) };
      return;
    }
    if (turnFailure) {
      yield { type: "error", error: friendlyFailure(new Error(turnFailure), stderr) };
      return;
    }
    if (closeCode !== 0 || closeSignal) {
      yield {
        type: "error",
        error: friendlyFailure(new Error(`Codex exited with ${closeCode ?? closeSignal}`), stderr),
      };
      return;
    }
    if (!turnCompleted) {
      yield { type: "error", error: "Codex가 작업을 끝내지 못했어. 다시 시도해 줘." };
      return;
    }

    yield { type: "completed", result: finalOutput.trim() || "요청한 분석을 마쳤어." };
  }
}

/** Signals the whole detached process group so commands Codex started stop with it. */
export function signalProcess(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to signaling the direct child if the process group has already exited.
    }
  }
  child.kill(signal);
}
