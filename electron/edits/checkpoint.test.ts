import { mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ABSENT,
  changedSinceCheckpoint,
  createCheckpoint,
  fileState,
  UndoRefused,
  undoEdit,
  withAfterStates,
} from "./checkpoint";

let root: string;
let store: string;

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), "poko-edit-"));
  root = join(base, "project");
  store = join(base, "checkpoint");
  await writeFile(join(base, "outside.txt"), "outside");
  await import("node:fs/promises").then((fs) => fs.mkdir(root, { recursive: true }));
  await writeFile(join(root, "a.txt"), "old a\n");
  await writeFile(join(root, "gone.txt"), "will be deleted\n");
});

afterEach(async () => {
  await rm(join(root, ".."), { recursive: true, force: true });
});

/** Simulates Codex applying a change: update a.txt, add new.txt, delete gone.txt. */
async function applyChange() {
  await writeFile(join(root, "a.txt"), "new a\n");
  await writeFile(join(root, "new.txt"), "added\n");
  await rm(join(root, "gone.txt"));
}

const paths = () => ["a.txt", "new.txt", "gone.txt"].map((name) => join(root, name));

describe("checkpoints and undo", () => {
  it("restores updated, added, and deleted files exactly", async () => {
    const before = await createCheckpoint(store, root, paths());
    expect(before.map((file) => file.existed)).toEqual([true, false, true]);
    expect(await changedSinceCheckpoint(store, before)).toBe(false);
    await applyChange();
    expect(await changedSinceCheckpoint(store, before)).toBe(true);
    const files = await withAfterStates(before);
    expect(files[2].after).toBe(ABSENT);

    await undoEdit(store, root, files);
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("old a\n");
    expect(await fileState(join(root, "new.txt"))).toBe(ABSENT);
    expect(await readFile(join(root, "gone.txt"), "utf8")).toBe("will be deleted\n");
  });

  it("refuses when a file changed after the edit, including one recreated after a delete", async () => {
    const files = await withAfterStates(
      await (async () => {
        const checkpoint = await createCheckpoint(store, root, paths());
        await applyChange();
        return checkpoint;
      })(),
    );
    await writeFile(join(root, "gone.txt"), "new work\n");
    await expect(undoEdit(store, root, files)).rejects.toBeInstanceOf(UndoRefused);
    // Nothing was touched.
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("new a\n");
    expect(await readFile(join(root, "gone.txt"), "utf8")).toBe("new work\n");
  });

  it("leaves every file as it was when the restore fails part way", async () => {
    const checkpoint = await createCheckpoint(store, root, paths());
    await applyChange();
    const files = await withAfterStates(checkpoint);
    let calls = 0;
    const failingRename: typeof rename = async (from, to) => {
      calls += 1;
      // The first restore (a.txt) succeeds, then the disk "fails".
      if (calls === 2) throw new Error("disk full");
      return rename(from, to);
    };
    await expect(undoEdit(store, root, files, { rename: failingRename })).rejects.toThrow(
      "disk full",
    );
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("new a\n");
    expect(await readFile(join(root, "new.txt"), "utf8")).toBe("added\n");
    expect(await fileState(join(root, "gone.txt"))).toBe(ABSENT);
  });

  it("refuses unknown after-states, paths outside the workspace, and symbolic links", async () => {
    const checkpoint = await createCheckpoint(store, root, [join(root, "a.txt")]);
    await expect(undoEdit(store, root, checkpoint)).rejects.toMatchObject({ reason: "unknown" });
    await expect(
      createCheckpoint(store, root, [join(root, "..", "outside.txt")]),
    ).rejects.toMatchObject({ reason: "outside" });
    await symlink(join(root, "..", "outside.txt"), join(root, "link.txt"));
    await expect(createCheckpoint(store, root, [join(root, "link.txt")])).rejects.toMatchObject({
      reason: "not_a_file",
    });
  });
});
