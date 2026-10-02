import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/** The Claude Code version the sandbox rules were verified with (see docs/phases/phase-12.md). */
export const MIN_COMMAND_VERSION = [2, 1, 287] as const;
export const MAX_COMMAND_LENGTH = 2000;
export const MAX_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

/** Folders that make the workspace too broad to open up for commands. */
const SYSTEM_FOLDERS = ["/", "/Users", "/Volumes", "/System", "/Library", "/private", "/usr"];

/** Toolchains under the home folder that commands may read; credentials are never listed. */
const TOOLCHAIN_FOLDERS = [
  ".nvm",
  ".fnm",
  ".local/share/fnm",
  ".volta",
  ".asdf",
  ".bun",
  ".deno",
  ".pyenv",
  ".rbenv",
  ".rustup",
  ".cargo/bin",
  ".local/bin",
  ".local/share/pnpm",
  "Library/pnpm",
  ".npm",
  ".cache/node",
  ".cache/pnpm",
  ".cache/yarn",
  ".yarn",
];

function versionAtLeast(version: string | null | undefined, minimum: readonly number[]): boolean {
  const parts = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? "");
  if (!parts) return false;
  for (let index = 0; index < minimum.length; index += 1) {
    const value = Number(parts[index + 1]);
    if (value !== minimum[index]) return value > minimum[index];
  }
  return true;
}

function contains(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep));
}

/**
 * Why commands can't run for this task, or null when they can. The sandbox rules are verified
 * only on macOS with a known Claude Code, and a workspace that holds the home folder (or is a
 * system folder) would reopen everything below it.
 */
export function commandsBlockedReason(
  workspace: string,
  home: string,
  platform: NodeJS.Platform,
  version: string | null | undefined,
): string | null {
  if (platform !== "darwin") return "명령 실행은 지금 macOS에서만 지원해.";
  if (!versionAtLeast(version, MIN_COMMAND_VERSION))
    return "명령 실행에는 Claude Code 2.1.287 이상이 필요해. claude update로 업데이트해 줘.";
  const folder = resolve(workspace);
  if (contains(folder, home) || SYSTEM_FOLDERS.includes(folder))
    return "작업 폴더가 너무 넓어서(홈 폴더나 시스템 폴더) 명령 실행은 막아 뒀어.";
  return null;
}

/** Folders a command may read besides the workspace and its temp folder. */
export function toolchainReads(home: string, nodeDirectory: string | null): string[] {
  const folders = TOOLCHAIN_FOLDERS.map((folder) => join(home, folder)).filter((folder) =>
    existsSync(folder),
  );
  // The folder that holds the found node (for example a Homebrew or nvm version's root).
  if (nodeDirectory) folders.push(dirname(nodeDirectory));
  return [...new Set(folders)];
}

/**
 * Settings for a task that may run commands: every Bash call asks, it runs in Claude Code's
 * sandbox with no way out, reads are denied except the workspace, its temp folder, and
 * toolchains, and no network or local sockets are allowed.
 */
export function commandSettings(options: {
  workspace: string;
  tempDir: string;
  reads: string[];
}): string {
  return JSON.stringify({
    permissions: { ask: ["Bash"] },
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false,
      filesystem: {
        denyRead: ["/Users", "/Volumes", "/tmp", "/private/tmp", "/private/var/folders"],
        allowRead: [options.workspace, options.tempDir, ...options.reads],
      },
      network: { allowUnixSockets: [], allowLocalBinding: false },
    },
  });
}

/**
 * Claude Code's own sign-in and setup variables. Other CLAUDE_* names belong to a parent Claude
 * Code session (for example a messaging token when Poko is started from one) and are dropped.
 */
const CLAUDE_NAMES = new Set([
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
  "CLAUDE_CODE_SKIP_VERTEX_AUTH",
]);

const KEPT_NAMES = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "TERM",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
]);

/**
 * The environment for a task that may run commands: an allowlist, so tokens in the app's
 * environment aren't handed to commands. Cloud variables stay only for the provider Claude
 * Code is set up to use.
 */
export function commandEnvironment(base: NodeJS.ProcessEnv, tempDir: string): NodeJS.ProcessEnv {
  const bedrock = Boolean(base.CLAUDE_CODE_USE_BEDROCK);
  const vertex = Boolean(base.CLAUDE_CODE_USE_VERTEX);
  const kept: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) continue;
    const keep =
      KEPT_NAMES.has(name) ||
      name.startsWith("LC_") ||
      name.startsWith("ANTHROPIC_") ||
      CLAUDE_NAMES.has(name) ||
      (bedrock && name.startsWith("AWS_")) ||
      (vertex && /^(GOOGLE_|CLOUD_ML_|VERTEX_)/.test(name));
    if (keep) kept[name] = value;
  }
  // Both point at the task's own folder: Claude Code keeps its shell's working-folder file in
  // the temp folder, and a shared one is unreadable and unwritable inside the sandbox.
  kept.CLAUDE_CODE_TMPDIR = tempDir;
  kept.TMPDIR = tempDir;
  return kept;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks a Bash request; returns a plain refusal, or null when it may be offered. */
export function commandRefusal(input: unknown): string | null {
  if (!isRecord(input) || typeof input.command !== "string" || !input.command.trim())
    return "실행할 명령을 알 수 없어서 거절했어.";
  if (input.command.length > MAX_COMMAND_LENGTH) return "명령이 너무 길어서 거절했어.";
  if (input.dangerouslyDisableSandbox === true)
    return "샌드박스 밖에서 실행하려는 명령이라 거절했어.";
  if (input.run_in_background === true)
    return "백그라운드로 계속 도는 명령은 지원하지 않아서 거절했어.";
  if (
    input.timeout !== undefined &&
    (typeof input.timeout !== "number" ||
      input.timeout <= 0 ||
      input.timeout > MAX_COMMAND_TIMEOUT_MS)
  )
    return "실행 시간이 5분을 넘는 명령은 지원하지 않아서 거절했어.";
  return null;
}

/** Added to the prompt when commands are offered, so Claude knows the limits up front. */
export const COMMANDS_NOTE =
  "Note for this engine: you may run project commands (tests, builds, linters) with Bash. Each one needs the user's approval and runs in a sandbox: it can write only inside the workspace (never .git), can't read the user's other files, and has no network. Keep using Edit/Write for file changes so they can be undone. Don't start background or long-running processes, and keep each command under 5 minutes.";
