import { existsSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where Claude Code keeps a session (Phase 20), and how Poko removes only the sessions it
 * created. Checked with Claude Code 2.1.296: `~/.claude/projects/<cwd>/<id>.jsonl`, where the
 * resolved working folder has every character other than letters and digits turned into "-".
 */

export function claudeConfigDir(env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude");
}

export function claudeTranscriptPath(env: NodeJS.ProcessEnv, cwd: string, id: string): string {
  return join(claudeConfigDir(env), "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), `${id}.jsonl`);
}

/** The transcript's size and modification time, to tell whether anyone else continued it. */
export function transcriptStamp(path: string): { size: number; mtimeMs: number } | null {
  try {
    const info = statSync(path);
    return { size: info.size, mtimeMs: Math.round(info.mtimeMs) };
  } catch {
    return null;
  }
}

export function transcriptExists(path: string): boolean {
  return existsSync(path);
}

/** Removes a session Poko created: its transcript and its saved file backups. */
export function deleteClaudeSession(env: NodeJS.ProcessEnv, cwd: string, id: string): void {
  // Only a session id (a UUID) is ever joined into a path.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const config = claudeConfigDir(env);
  rmSync(claudeTranscriptPath(env, cwd, id), { force: true });
  rmSync(join(config, "file-history", id), { recursive: true, force: true });
  rmSync(join(config, "session-env", id), { recursive: true, force: true });
}
