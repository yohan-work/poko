import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where Claude Code keeps a session (Phase 20), and how Poko removes only the sessions it
 * created. Checked with Claude Code 2.1.296: `~/.claude/projects/<cwd>/<id>.jsonl`, where the
 * resolved working folder has every character other than letters and digits turned into "-".
 * A very long folder name is shortened by Claude Code, so a session is also looked up by id.
 */

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function claudeConfigDir(env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude");
}

/** The session's transcript, or null when Claude Code has none for it. */
export function findClaudeTranscript(
  env: NodeJS.ProcessEnv,
  cwd: string,
  id: string,
): string | null {
  if (!SESSION_ID.test(id)) return null;
  const projects = join(claudeConfigDir(env), "projects");
  const expected = join(projects, cwd.replace(/[^A-Za-z0-9]/g, "-"), `${id}.jsonl`);
  if (existsSync(expected)) return expected;
  try {
    for (const folder of readdirSync(projects)) {
      const path = join(projects, folder, `${id}.jsonl`);
      if (existsSync(path)) return path;
    }
  } catch {
    /* no projects folder */
  }
  return null;
}

/**
 * Removes a session Poko created: its transcript and its saved file backups. Removed again a
 * moment later too, since a Claude Code still exiting may write its transcript once more.
 */
export function deleteClaudeSession(env: NodeJS.ProcessEnv, cwd: string, id: string): void {
  if (!SESSION_ID.test(id)) return;
  const remove = (): void => {
    const transcript = findClaudeTranscript(env, cwd, id);
    if (transcript) rmSync(transcript, { force: true });
    const config = claudeConfigDir(env);
    rmSync(join(config, "file-history", id), { recursive: true, force: true });
    rmSync(join(config, "session-env", id), { recursive: true, force: true });
  };
  remove();
  setTimeout(() => {
    try {
      remove();
    } catch {
      /* best effort */
    }
  }, 5000).unref?.();
}
