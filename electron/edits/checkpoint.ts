import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";

/** A file's state: its SHA-256, or "absent" when it doesn't exist. */
export type FileState = string;
export const ABSENT = "absent";

/** One file of an approved change. Its original bytes are `<checkpoint>/<slot>` when it existed. */
export interface EditFile {
  path: string;
  existed: boolean;
  slot: number;
  /** The state right after the change; null until known. */
  after: FileState | null;
}

export class UndoRefused extends Error {
  constructor(
    readonly file: string,
    readonly reason: "changed" | "unknown" | "outside" | "not_a_file",
  ) {
    super(`Undo refused for ${file}: ${reason}`);
  }
}

export function isInside(root: string, path: string): boolean {
  const relation = relative(root, path);
  return relation !== "" && !relation.startsWith("..") && !isAbsolute(relation);
}

/** Only regular files (or nothing) are checkpointed: never folders or symbolic links. */
async function regularOrAbsent(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

export async function fileState(path: string): Promise<FileState> {
  try {
    return createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ABSENT;
    throw error;
  }
}

/** Copies each file's current bytes into `dir` before a change is accepted. */
export async function createCheckpoint(
  dir: string,
  root: string,
  paths: string[],
): Promise<EditFile[]> {
  await mkdir(dir, { recursive: true });
  const files: EditFile[] = [];
  for (const [slot, path] of paths.entries()) {
    if (!isInside(root, path)) throw new UndoRefused(path, "outside");
    if (!(await regularOrAbsent(path))) throw new UndoRefused(path, "not_a_file");
    let bytes: Buffer | null = null;
    try {
      bytes = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (bytes) await writeFile(join(dir, String(slot)), bytes);
    files.push({ path, existed: bytes !== null, slot, after: null });
  }
  return files;
}

/** Records the state after the change. */
export async function withAfterStates(files: EditFile[]): Promise<EditFile[]> {
  return Promise.all(files.map(async (file) => ({ ...file, after: await fileState(file.path) })));
}

/** Whether any file differs from its checkpoint, i.e. the change (or part of it) happened. */
export async function changedSinceCheckpoint(dir: string, files: EditFile[]): Promise<boolean> {
  for (const file of files) {
    const before = file.existed ? await fileState(join(dir, String(file.slot))) : ABSENT;
    if ((await fileState(file.path)) !== before) return true;
  }
  return false;
}

export interface UndoOps {
  rename: typeof rename;
}

/**
 * Restores every file to its checkpoint, all or nothing. Each file must still be exactly as the
 * change left it, so newer work is never overwritten. Restored files are written to a temporary
 * name beside the target and renamed into place. If anything fails, the files are put back as
 * they were before the undo started.
 */
export async function undoEdit(
  dir: string,
  root: string,
  files: EditFile[],
  ops: UndoOps = { rename },
): Promise<void> {
  for (const file of files) {
    if (!isInside(root, file.path)) throw new UndoRefused(file.path, "outside");
    if (file.after === null) throw new UndoRefused(file.path, "unknown");
    if (!(await regularOrAbsent(file.path))) throw new UndoRefused(file.path, "not_a_file");
    if ((await fileState(file.path)) !== file.after) throw new UndoRefused(file.path, "changed");
  }

  // Snapshot of the current state, to roll back a partial restore.
  const snapshot = join(dir, `undo-${randomUUID()}`);
  await mkdir(snapshot, { recursive: true });
  const current = new Map<number, boolean>();
  for (const file of files) {
    try {
      await writeFile(join(snapshot, String(file.slot)), await readFile(file.path));
      current.set(file.slot, true);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      current.set(file.slot, false);
    }
  }

  const put = async (target: string, bytes: Buffer) => {
    await mkdir(dirname(target), { recursive: true });
    const temporary = join(dirname(target), `.poko-undo-${randomUUID()}`);
    await writeFile(temporary, bytes);
    try {
      await ops.rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  };

  try {
    for (const file of files) {
      if (file.existed) await put(file.path, await readFile(join(dir, String(file.slot))));
      else await rm(file.path, { force: true });
    }
  } catch (error) {
    for (const file of files) {
      try {
        if (current.get(file.slot))
          await put(file.path, await readFile(join(snapshot, String(file.slot))));
        else await unlink(file.path).catch(() => undefined);
      } catch {
        // Keep restoring the others; the original error is reported.
      }
    }
    throw error;
  } finally {
    await rm(snapshot, { recursive: true, force: true });
  }
}
