import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Writes a file only the user can read (0600). It writes a new temp file beside the target and
 * renames it into place, so overwriting an existing file can't keep that file's permissions.
 */
export async function writePrivateFile(path: string, content: string): Promise<void> {
  const temp = join(dirname(path), `.poko-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, content, { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** The local date as YYYY-MM-DD, for file names. */
export function localDate(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
