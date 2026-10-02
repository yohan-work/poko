import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planEdit, unifiedDiff } from "./claudeEdits";

let root: string;
let outside: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "poko-claude-edit-"));
  outside = mkdtempSync(join(tmpdir(), "poko-claude-outside-"));
  writeFileSync(join(root, "README.md"), "# Sample\nA tiny sample.\n# Sample again\n");
  mkdirSync(join(root, ".git"));
  writeFileSync(join(outside, "secret.txt"), "secret\n");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const edit = (input: Record<string, unknown>) =>
  planEdit(root, "Edit", { file_path: join(root, "README.md"), ...input });

describe("planEdit", () => {
  it("computes an Edit from the disk and shows it as a diff", () => {
    const plan = edit({ old_string: "A tiny sample.", new_string: "A small sample." });
    expect(plan).toMatchObject({
      before: "# Sample\nA tiny sample.\n# Sample again\n",
      after: "# Sample\nA small sample.\n# Sample again\n",
    });
    expect("change" in plan && plan.change).toBe(
      "update:\n@@\n # Sample\n-A tiny sample.\n+A small sample.\n # Sample again",
    );
  });

  it("shows every match for replace_all and refuses an ambiguous single edit", () => {
    const all = edit({ old_string: "# Sample", new_string: "# Poko", replace_all: true });
    expect("after" in all && all.after).toBe("# Poko\nA tiny sample.\n# Poko again\n");
    expect("change" in all && all.change.match(/^\+/gm)?.length).toBe(2);
    expect(edit({ old_string: "# Sample", new_string: "# Poko" })).toEqual({
      refusal: "바꿀 부분이 여러 곳이라 어느 것인지 알 수 없어서 거절했어.",
    });
    expect(edit({ old_string: "missing", new_string: "x" })).toHaveProperty("refusal");
  });

  it("matches multi-line edits in CRLF files the way Claude Code does", () => {
    writeFileSync(join(root, "win.txt"), "one\r\ntwo\r\nthree\r\n");
    const plan = planEdit(root, "Edit", {
      file_path: join(root, "win.txt"),
      old_string: "one\ntwo",
      new_string: "ONE\nTWO",
    });
    expect("after" in plan && plan.after).toBe("ONE\r\nTWO\r\nthree\r\n");
    expect("change" in plan && plan.change).toBe(
      "update:\n@@\n-one\r\n-two\r\n+ONE\r\n+TWO\r\n three\r",
    );
  });

  it("refuses an Edit that only matches after guessing line endings in a mixed file", () => {
    writeFileSync(join(root, "mixed.txt"), "one\r\ntwo\nthree\n");
    expect(
      planEdit(root, "Edit", {
        file_path: join(root, "mixed.txt"),
        old_string: "one\ntwo",
        new_string: "x",
      }),
    ).toHaveProperty("refusal");
  });

  it("shows a Write that only changes line endings", () => {
    writeFileSync(join(root, "win.txt"), "a\r\nb\r\n");
    const plan = planEdit(root, "Write", { file_path: join(root, "win.txt"), content: "a\nb\n" });
    expect("change" in plan && plan.change).toBe("update:\n@@\n-a\r\n-b\r\n+a\n+b");
  });

  it("shows a change to only the final newline", () => {
    const plan = planEdit(root, "Write", {
      file_path: join(root, "README.md"),
      content: "# Sample\nA tiny sample.\n# Sample again",
    });
    expect("change" in plan && plan.change).toBe("update:\n-(파일 끝 줄바꿈 삭제)");
  });

  it("shows a new file as added text", () => {
    const plan = planEdit(root, "Write", { file_path: join(root, "notes.md"), content: "hi\n" });
    expect(plan).toMatchObject({ before: null, after: "hi\n", change: "add:\nhi\n" });
  });

  it("refuses paths outside the workspace, through a symlink, and in git files", () => {
    symlinkSync(outside, join(root, "linked"));
    for (const path of [
      join(outside, "secret.txt"),
      join(root, "linked", "secret.txt"),
      join(root, "..", "elsewhere.txt"),
      "relative.txt",
    ])
      expect(planEdit(root, "Write", { file_path: path, content: "x" })).toHaveProperty("refusal");
    expect(
      planEdit(root, "Write", { file_path: join(root, ".git", "config"), content: "x" }),
    ).toEqual({
      refusal: "git 저장소 파일은 바꾸지 않아서 거절했어.",
    });
    expect(planEdit(root, "Write", { file_path: join(root, "sub", "HEAD"), content: "x" })).toEqual(
      {
        refusal: "git 저장소 파일은 바꾸지 않아서 거절했어.",
      },
    );
  });

  it("refuses binary content and other tools", () => {
    expect(
      planEdit(root, "Write", { file_path: join(root, "a.bin"), content: "a\u0000b" }),
    ).toHaveProperty("refusal");
    expect(planEdit(root, "Bash", { command: "rm -rf /" })).toHaveProperty("refusal");
  });
});

describe("unifiedDiff", () => {
  it("keeps three lines of context and breaks long unchanged runs into hunks", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 2", "LINE 2").replace("line 17", "LINE 17");
    const diff = unifiedDiff(before, after).split("\n");
    expect(diff.filter((line) => line === "@@")).toHaveLength(2);
    expect(diff).toContain("-line 2");
    expect(diff).toContain("+LINE 17");
    expect(diff).not.toContain(" line 10");
  });
});
