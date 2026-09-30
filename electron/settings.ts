import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

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
