import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localDate, writePrivateFile } from "./privateFile";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "poko-private-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("writePrivateFile", () => {
  it("writes a new file only the user can read", async () => {
    const path = join(directory, "export.json");
    await writePrivateFile(path, "{}");
    expect(await readFile(path, "utf8")).toBe("{}");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("makes an overwritten file private too and leaves no temp file", async () => {
    const path = join(directory, "export.json");
    await writeFile(path, "old");
    await chmod(path, 0o644);
    await writePrivateFile(path, "new");
    expect(await readFile(path, "utf8")).toBe("new");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(["export.json"]);
  });
});

describe("localDate", () => {
  it("formats the local date", () => {
    expect(localDate(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});
