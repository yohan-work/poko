import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PokoDatabase } from "../database/Database";
import { EditManager, KEEP_DAYS } from "./EditManager";

let base: string;
let project: string;
let checkpoints: string;
let database: PokoDatabase;
let manager: EditManager;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "poko-edits-"));
  project = join(base, "project");
  checkpoints = join(base, "checkpoints");
  await mkdir(project);
  await writeFile(join(project, "README.md"), "# Sample\n");
  database = await PokoDatabase.open(join(base, "poko.sqlite"), join(process.cwd(), "drizzle"));
  manager = new EditManager(database, checkpoints);
});

afterEach(async () => {
  database.close();
  await rm(base, { recursive: true, force: true });
});

const readme = () => join(project, "README.md");

describe("EditManager", () => {
  it("checkpoints, settles an applied change, and undoes it", async () => {
    const task = database.createTask("제목 바꿔 줘", project);
    const conversation = database.getTaskConversation(task)?.id as string;
    await manager.checkpoint(task, "7", project, [readme()]);
    expect(manager.notes(conversation)).toEqual([]); // still pending

    await writeFile(readme(), "# Poko Sample\n"); // Codex applies the change
    expect(await manager.settle(task)).toBe(true);
    const [note] = manager.notes(conversation);
    expect(note).toMatchObject({ status: "applied", files: ["README.md"] });

    expect(await manager.undo(note.id)).toBeNull();
    expect(await readFile(readme(), "utf8")).toBe("# Sample\n");
    expect(manager.notes(conversation)).toMatchObject([{ status: "undone" }]);
    expect(await readdir(checkpoints)).toEqual([]);
    const activity = database.getBootstrapData().activities.map((entry) => entry.message);
    expect(activity).toEqual(
      expect.arrayContaining(["파일을 바꿨어: README.md", "변경을 되돌렸어: README.md"]),
    );
    // A second undo is refused.
    expect(await manager.undo(note.id)).toContain("되돌릴 수 없어");
  });

  it("marks a change that never happened as failed and drops its checkpoint", async () => {
    const task = database.createTask("제목 바꿔 줘", project);
    const conversation = database.getTaskConversation(task)?.id as string;
    await manager.checkpoint(task, "7", project, [readme()]);
    await manager.settle(task);
    expect(manager.notes(conversation)).toEqual([]);
    expect(await readdir(checkpoints)).toEqual([]);
  });

  it("refuses to undo over newer work and says which file", async () => {
    const task = database.createTask("제목 바꿔 줘", project);
    const conversation = database.getTaskConversation(task)?.id as string;
    await manager.checkpoint(task, "7", project, [readme()]);
    await writeFile(readme(), "# Poko Sample\n");
    await manager.settle(task);
    await writeFile(readme(), "# Edited by hand\n");
    const [note] = manager.notes(conversation);
    expect(await manager.undo(note.id)).toContain("README.md");
    expect(await readFile(readme(), "utf8")).toBe("# Edited by hand\n");
    expect(manager.notes(conversation)).toMatchObject([{ status: "applied" }]);
  });

  it("forgets a deleted conversation's checkpoints and expires old edits", async () => {
    const task = database.createTask("제목 바꿔 줘", project);
    const conversation = database.getTaskConversation(task)?.id as string;
    await manager.checkpoint(task, "7", project, [readme()]);
    await writeFile(readme(), "# Poko Sample\n");
    await manager.settle(task);

    const later = new Date(Date.now() + (KEEP_DAYS + 1) * 24 * 60 * 60 * 1000);
    await manager.expireOld(KEEP_DAYS, later);
    expect(manager.notes(conversation)).toMatchObject([{ status: "expired" }]);
    expect(await readdir(checkpoints)).toEqual([]);

    const second = database.createTask("다시", project, conversation);
    await manager.checkpoint(second, "8", project, [readme()]);
    expect((await readdir(checkpoints)).length).toBe(1);
    await manager.forgetConversation(conversation);
    expect(await readdir(checkpoints)).toEqual([]);
  });

  it("keeps edits for the chosen number of days", async () => {
    const task = database.createTask("제목 바꿔 줘", project);
    const conversation = database.getTaskConversation(task)?.id as string;
    await manager.checkpoint(task, "7", project, [readme()]);
    await writeFile(readme(), "# Poko Sample\n");
    await manager.settle(task);

    const eightDaysLater = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    await manager.expireOld(30, eightDaysLater);
    expect(manager.notes(conversation)).toMatchObject([{ status: "applied" }]);
    await manager.expireOld(7, eightDaysLater);
    expect(manager.notes(conversation)).toMatchObject([{ status: "expired" }]);
    expect(await readdir(checkpoints)).toEqual([]);
  });

  it("drops old edits that never applied instead of showing them as changes", async () => {
    const task = database.createTask("제목 바꿔 줘", project);
    const conversation = database.getTaskConversation(task)?.id as string;
    await manager.checkpoint(task, "7", project, [readme()]); // left pending
    const later = new Date(Date.now() + (KEEP_DAYS + 1) * 24 * 60 * 60 * 1000);
    await manager.expireOld(KEEP_DAYS, later);
    expect(manager.notes(conversation)).toEqual([]);
    expect(await readdir(checkpoints)).toEqual([]);
  });
});
