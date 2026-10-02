import type { CodexSetup } from "../shared";

/** The oldest Codex Poko was verified with (permission profiles, localImage, approvals). */
export const MINIMUM_VERSION = [0, 159, 0] as const;
/** Features a screen task turns off; a Codex without them can't run screen tasks safely. */
export const REQUIRED_FEATURES = ["shell_tool", "unified_exec"];

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface SetupProbe {
  /** The resolved `codex`, or null when it isn't installed. */
  codexPath: string | null;
  /** Whether `codex` is a node script and no `node` was found to run it. */
  missingNode: boolean;
  run(args: string[]): Promise<RunResult>;
}

export function parseVersion(output: string): [number, number, number] | null {
  const match = /codex-cli\s+(\d+)\.(\d+)\.(\d+)/.exec(output);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function atLeast(version: readonly number[], minimum: readonly number[]): boolean {
  for (let i = 0; i < minimum.length; i += 1) {
    if ((version[i] ?? 0) !== minimum[i]) return (version[i] ?? 0) > minimum[i];
  }
  return true;
}

/**
 * `codex login status` writes to stderr. Signed in means exit code 0 and a line that starts
 * with "Logged in using ChatGPT"; an API-key sign-in is reported separately.
 */
export function parseLogin(result: RunResult): CodexSetup["login"] {
  const lines = `${result.stdout}\n${result.stderr}`.split("\n").map((line) => line.trim());
  if (result.code !== 0) return "signed_out";
  if (lines.some((line) => line.startsWith("Logged in using ChatGPT"))) return "chatgpt";
  if (lines.some((line) => /^Logged in using (an )?API key/i.test(line))) return "api_key";
  return "signed_out";
}

export async function checkCodexSetup(probe: SetupProbe): Promise<CodexSetup> {
  if (!probe.codexPath)
    return {
      installed: false,
      path: null,
      version: null,
      missingNode: false,
      login: "unknown",
      featuresOk: false,
      ready: false,
    };
  if (probe.missingNode)
    return {
      installed: true,
      path: probe.codexPath,
      version: null,
      missingNode: true,
      login: "unknown",
      featuresOk: false,
      ready: false,
    };

  const [versionResult, loginResult, featuresResult] = await Promise.all([
    probe.run(["--version"]),
    probe.run(["login", "status"]),
    probe.run(["features", "list"]),
  ]);
  const version = parseVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
  const login = parseLogin(loginResult);
  const featureNames = new Set(
    featuresResult.stdout.split("\n").map((line) => line.trim().split(/\s+/)[0]),
  );
  const featuresOk =
    featuresResult.code === 0 && REQUIRED_FEATURES.every((name) => featureNames.has(name));
  const versionOk = version !== null && atLeast(version, MINIMUM_VERSION);
  return {
    installed: true,
    path: probe.codexPath,
    version: version ? version.join(".") : null,
    missingNode: false,
    login,
    featuresOk: versionOk && featuresOk,
    ready: versionOk && featuresOk && login === "chatgpt",
  };
}
