import { type ChildProcess, execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import type { CodexRuntime } from "../providers/codex/CodexAppServerProvider";
import { resolveCodexExecutable } from "../providers/codex/CodexProvider";
import {
  codexEnvironment,
  findNodeDirectory,
  needsNode,
  nodeCandidates,
  nodeOnPath,
} from "../providers/codex/codexEnvironment";
import type { CodexSetup } from "../shared";
import { checkCodexSetup, type RunResult } from "./codexSetup";

const CHECK_TIMEOUT_MS = 10_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds Codex and the environment to start it with, checks the setup, and runs `codex login`
 * when the user asks. Main process only.
 */
export class SetupService {
  private current: CodexRuntime = { executable: "codex", environment: process.env };
  private status: CodexSetup | null = null;
  private login: ChildProcess | null = null;

  constructor(private readonly onChange: (status: CodexSetup) => void) {}

  /** The Codex every provider starts; updated by each check. */
  runtime = (): CodexRuntime => this.current;

  /** Finds Codex and builds its environment; fast, no Codex commands run. */
  async resolveRuntime(): Promise<{ installed: boolean; missingNode: boolean; path: string }> {
    const found = await resolveCodexExecutable();
    const installed = found !== "codex" && (await isExecutable(found));
    const nodeDirectory = await findNodeDirectory(await nodeCandidates());
    this.current = installed
      ? { executable: found, environment: codexEnvironment(found, nodeDirectory) }
      : { executable: "codex", environment: process.env };
    // A node script starts if `node` is anywhere on the PATH Codex gets.
    const missingNode =
      installed && (await needsNode(found)) && !(await nodeOnPath(this.current.environment.PATH));
    return { installed, missingNode, path: found };
  }

  async refresh(): Promise<CodexSetup> {
    const { installed, missingNode, path } = await this.resolveRuntime();
    const status = await checkCodexSetup({
      codexPath: installed ? path : null,
      missingNode,
      run: (args) => this.run(args),
    });
    const real = installed ? await realpath(path).catch(() => path) : null;
    // Homebrew keeps formulae and casks under Cellar or Caskroom; anything else came from npm.
    const source =
      real === null ? undefined : /\/(Cellar|Caskroom)\//.test(real) ? "homebrew" : "npm";
    this.status = { ...status, ...(source ? { source } : {}), loggingIn: this.login !== null };
    return this.status;
  }

  get lastStatus(): CodexSetup | null {
    return this.status;
  }

  /** Starts `codex login` once; the browser handles the sign-in. */
  startLogin(): "started" | "already" | "unavailable" {
    if (this.login) return "already";
    if (!this.status?.installed || this.status.missingNode) return "unavailable";
    const child = spawn(this.current.executable, ["login"], {
      env: this.current.environment,
      stdio: "ignore",
    });
    this.login = child;
    const timer = setTimeout(() => child.kill("SIGTERM"), LOGIN_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      if (this.login === child) this.login = null;
      // Whatever happened, show the current sign-in right away.
      void this.refresh().then((status) => this.onChange(status));
    };
    child.once("exit", done);
    child.once("error", done);
    if (this.status) this.onChange({ ...this.status, loggingIn: true });
    return "started";
  }

  cancelLogin(): void {
    this.login?.kill("SIGTERM");
  }

  private run(args: string[]): Promise<RunResult> {
    return new Promise((resolve) => {
      execFile(
        this.current.executable,
        args,
        { env: this.current.environment, timeout: CHECK_TIMEOUT_MS },
        (error, stdout, stderr) => {
          const code =
            error && typeof (error as NodeJS.ErrnoException).code === "number"
              ? (error as unknown as { code: number }).code
              : error
                ? 1
                : 0;
          resolve({ code, stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
  }
}
