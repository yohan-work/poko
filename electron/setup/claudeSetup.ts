import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  codexEnvironment,
  findNodeDirectory,
  nodeCandidates,
} from "../providers/codex/codexEnvironment";
import { resolveCliExecutable } from "../providers/codex/CodexProvider";
import type { ClaudeRuntime } from "../providers/claude/ClaudeCodeProvider";
import type { ClaudeSetup } from "../shared";
import type { RunResult } from "./codexSetup";

const CHECK_TIMEOUT_MS = 10_000;
/** Options Poko starts Claude Code with; an older CLI without them can't run tasks safely. */
export const REQUIRED_OPTIONS = [
  "--input-format",
  "--include-partial-messages",
  "--safe-mode",
  "--setting-sources",
];

export function parseClaudeVersion(output: string): string | null {
  return /(\d+\.\d+\.\d+)\s*\(Claude Code\)/.exec(output)?.[1] ?? null;
}

/** `claude auth status --json` prints `{ loggedIn, authMethod, ... }`; nothing else is read. */
export function parseClaudeLogin(result: RunResult): ClaudeSetup["login"] {
  try {
    const status = JSON.parse(result.stdout) as { loggedIn?: unknown };
    if (status.loggedIn === true) return "signed_in";
    if (status.loggedIn === false) return "signed_out";
  } catch {
    /* not JSON */
  }
  return result.code === 0 ? "unknown" : "signed_out";
}

export async function checkClaudeSetup(probe: {
  claudePath: string | null;
  run(args: string[]): Promise<RunResult>;
}): Promise<ClaudeSetup> {
  if (!probe.claudePath)
    return {
      installed: false,
      path: null,
      version: null,
      login: "unknown",
      featuresOk: false,
      ready: false,
    };
  const [versionResult, loginResult, helpResult] = await Promise.all([
    probe.run(["--version"]),
    probe.run(["auth", "status", "--json"]),
    probe.run(["--help"]),
  ]);
  const version = parseClaudeVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
  const login = parseClaudeLogin(loginResult);
  const featuresOk =
    helpResult.code === 0 && REQUIRED_OPTIONS.every((option) => helpResult.stdout.includes(option));
  return {
    installed: true,
    path: probe.claudePath,
    version,
    login,
    featuresOk,
    ready: login === "signed_in" && featuresOk,
  };
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Finds the user's `claude` and checks it; sign-in happens in their terminal, not in Poko. */
export class ClaudeSetupService {
  private current: ClaudeRuntime = { executable: "claude", environment: process.env };

  /** The Claude Code every task starts; updated by each check. */
  runtime = (): ClaudeRuntime => this.current;

  /** Finds `claude` and builds its environment; fast, no Claude Code commands run. */
  async resolveRuntime(): Promise<string | null> {
    const found = await resolveCliExecutable("claude", [join(homedir(), ".claude", "local")]);
    const installed = found !== "claude" && (await isExecutable(found));
    // An npm-installed `claude` is a node script, so it gets the same PATH fallbacks as Codex.
    this.current = installed
      ? {
          executable: found,
          environment: codexEnvironment(found, await findNodeDirectory(await nodeCandidates())),
        }
      : { executable: "claude", environment: process.env };
    return installed ? found : null;
  }

  async refresh(): Promise<ClaudeSetup> {
    const claudePath = await this.resolveRuntime();
    return checkClaudeSetup({ claudePath, run: (args) => this.run(args) });
  }

  private run(args: string[]): Promise<RunResult> {
    return new Promise((resolve) => {
      execFile(
        this.current.executable,
        args,
        { env: this.current.environment, timeout: CHECK_TIMEOUT_MS },
        (error, stdout, stderr) => {
          const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
          resolve({ code, stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
  }
}
