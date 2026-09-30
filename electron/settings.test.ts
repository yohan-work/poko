import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWorkspacePath, writeWorkspacePath } from "./settings";

let temporaryDirectory = "";

async function createSettingsPath(): Promise<string> {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "poko-settings-"));
  return join(temporaryDirectory, "nested", "settings.json");
}

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = "";
});

describe("workspace settings", () => {
  it("persists a selected workspace for the next app launch", async () => {
    const settingsFile = await createSettingsPath();

    await writeWorkspacePath(settingsFile, "/Users/example/Projects/poko");

    await expect(readWorkspacePath(settingsFile)).resolves.toBe("/Users/example/Projects/poko");
    await expect(readFile(settingsFile, "utf8")).resolves.toContain('"workspacePath"');
  });

  it("ignores missing, malformed, and non-absolute workspace settings", async () => {
    const settingsFile = await createSettingsPath();

    await expect(readWorkspacePath(settingsFile)).resolves.toBeNull();
    await mkdir(dirname(settingsFile), { recursive: true });
    await writeFile(settingsFile, "not valid json");
    await expect(readWorkspacePath(settingsFile)).resolves.toBeNull();
    await writeFile(settingsFile, JSON.stringify({ workspacePath: "relative/path" }));
    await expect(readWorkspacePath(settingsFile)).resolves.toBeNull();
  });
});
