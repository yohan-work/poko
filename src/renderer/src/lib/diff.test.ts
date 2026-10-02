import { describe, expect, it } from "vitest";
import { parseChange, relativePath } from "./diff";

describe("parseChange", () => {
  it("reads an update as a unified diff with counts", () => {
    const parsed = parseChange(
      "update:\n@@ -1,2 +1,2 @@\n-# Sample\n+# Poko Sample\n A tiny project.\n",
    );
    expect(parsed).toMatchObject({ kind: "update", added: 1, removed: 1 });
    expect(parsed.lines.map((line) => line.kind)).toEqual(["hunk", "remove", "add", "context"]);
  });

  it("treats an added file as additions and a deleted file as removals", () => {
    expect(parseChange("add:\nline one\nline two")).toMatchObject({
      kind: "add",
      added: 2,
      removed: 0,
    });
    expect(parseChange("delete:\nold")).toMatchObject({
      kind: "delete",
      removed: 1,
      lines: [{ kind: "remove", text: "-old" }],
    });
  });

  it("doesn't count file headers as changed lines", () => {
    expect(parseChange("update:\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b")).toMatchObject({
      added: 1,
      removed: 1,
    });
  });
});

describe("relativePath", () => {
  it("shows workspace files relative to the workspace", () => {
    expect(relativePath("/w/proj/src/a.ts", "/w/proj")).toBe("src/a.ts");
    expect(relativePath("/w/proj/a.ts", "/w/proj/")).toBe("a.ts");
    expect(relativePath("/w/projX/a.ts", "/w/proj")).toBe("/w/projX/a.ts");
    expect(relativePath("a.ts", null)).toBe("a.ts");
  });
});
