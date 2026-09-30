import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

interface PersistedSettings {
  workspacePath: string | null;
}

export async function readWorkspacePath(settingsFile: string): Promise<string | null> {
  try {
    const contents = await readFile(settingsFile, "utf8");
    const parsed: unknown = JSON.parse(contents);

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "workspacePath" in parsed &&
      typeof parsed.workspacePath === "string" &&
      isAbsolute(parsed.workspacePath)
    ) {
      return parsed.workspacePath;
    }

    return null;
  } catch {
    return null;
  }
}

export async function writeWorkspacePath(
  settingsFile: string,
  workspacePath: string | null,
): Promise<void> {
  const settings: PersistedSettings = { workspacePath };
  const temporaryFile = `${settingsFile}.${randomUUID()}.tmp`;

  await mkdir(dirname(settingsFile), { recursive: true });

  try {
    await writeFile(temporaryFile, JSON.stringify(settings, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryFile, settingsFile);
  } finally {
    await rm(temporaryFile, { force: true });
  }
}
