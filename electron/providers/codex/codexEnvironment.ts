import { constants } from "node:fs";
import { access, open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

const HOMEBREW = ["/opt/homebrew/bin", "/usr/local/bin"];

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Folders that may hold `node`, newest nvm version first. Only known install places. */
export async function nodeCandidates(home = homedir()): Promise<string[]> {
  const nvm = join(home, ".nvm", "versions", "node");
  const versions = await readdir(nvm).catch(() => [] as string[]);
  return [
    ...versions
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .map((version) => join(nvm, version, "bin")),
    join(home, ".volta", "bin"),
    join(home, ".asdf", "shims"),
    join(home, ".local", "share", "fnm", "aliases", "default", "bin"),
    ...HOMEBREW,
  ];
}

/** The first known folder that holds an executable `node`, or null. */
export async function findNodeDirectory(
  candidates: string[],
  isExecutable: (path: string) => Promise<boolean> = executable,
): Promise<string | null> {
  for (const folder of candidates) if (await isExecutable(join(folder, "node"))) return folder;
  return null;
}

/** Whether a file starts with `#!/usr/bin/env node`, i.e. it needs `node` on PATH to start. */
export async function needsNode(path: string): Promise<boolean> {
  const file = await open(path, "r").catch(() => null);
  if (!file) return false;
  try {
    const { bytesRead, buffer } = await file.read(Buffer.alloc(64), 0, 64, 0);
    return /^#!\S*\benv\s+node\b/.test(buffer.subarray(0, bytesRead).toString("utf8"));
  } finally {
    await file.close();
  }
}

/**
 * The environment for every Codex process. An app opened from Finder gets a minimal PATH, so
 * the folder of `codex` (where nvm keeps `node`), a known `node` folder, and Homebrew's folders
 * come first, then the inherited PATH. No login shell is ever run.
 */
export function codexEnvironment(
  codexPath: string,
  nodeDirectory: string | null,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const folders = [
    dirname(codexPath),
    ...(nodeDirectory ? [nodeDirectory] : []),
    ...HOMEBREW,
    ...(base.PATH ?? "").split(delimiter).filter(Boolean),
  ];
  return { ...base, PATH: [...new Set(folders)].join(delimiter) };
}
