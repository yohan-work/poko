import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorkspaceDirectory } from "./workspace";

let temporaryDirectory = "";

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = "";
});

describe("workspace execution boundary", () => {
  it("canonicalizes an existing selected folder", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "poko-workspace-"));
    const nestedDirectory = join(temporaryDirectory, "project");
    await mkdir(nestedDirectory);

    await expect(resolveWorkspaceDirectory(nestedDirectory)).resolves.toBe(
      await realpath(nestedDirectory),
    );
  });

  it("rejects missing paths, files, and an empty selection", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "poko-workspace-"));
    const filePath = join(temporaryDirectory, "readme.txt");
    await writeFile(filePath, "fixture");

    await expect(resolveWorkspaceDirectory(null)).rejects.toThrow("먼저 작업할 폴더");
    await expect(resolveWorkspaceDirectory(join(temporaryDirectory, "missing"))).rejects.toThrow(
      "저장된 작업 폴더",
    );
    await expect(resolveWorkspaceDirectory(filePath)).rejects.toThrow("저장된 작업 폴더");
  });
});
