import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { buildsRepository, isInside, touchesGitDirectory } from "../codex/CodexAppServerProvider";

/** Files larger than this aren't shown or changed through an approval card. */
const MAX_FILE_BYTES = 512 * 1024;
const CONTEXT_LINES = 3;
/** Above this much work the diff falls back to whole-block removal and addition. */
const MAX_DIFF_CELLS = 1_000_000;

/** A change Poko computed itself from Claude Code's Edit or Write input. */
export interface PlannedEdit {
  path: string;
  /** The file's text when the card was made, or null for a new file. */
  before: string | null;
  after: string;
  /** In the provider's diff format: `add:\n<text>` or `update:\n<unified diff>`. */
  change: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBinary(text: string): boolean {
  return text.includes("\u0000");
}

function readCurrent(path: string): string | null | "unreadable" {
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(path);
  } catch {
    return null;
  }
  if (!stats.isFile() || stats.size > MAX_FILE_BYTES) return "unreadable";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "unreadable";
  }
}

function count(text: string, search: string): number {
  let total = 0;
  for (let at = text.indexOf(search); at !== -1; at = text.indexOf(search, at + search.length))
    total += 1;
  return total;
}

/**
 * Checks an Edit or Write request and computes the result from the disk, so the card shows
 * what will really change (every match for `replace_all`). Returns a plain refusal otherwise.
 */
export function planEdit(
  cwd: string,
  toolName: string,
  input: unknown,
): PlannedEdit | { refusal: string } {
  if (!isRecord(input) || typeof input.file_path !== "string" || !isAbsolute(input.file_path))
    return { refusal: "변경할 파일을 알 수 없어서 거절했어." };
  const path = resolve(input.file_path);
  if (!isInside(cwd, path)) return { refusal: "작업 폴더 밖의 파일이라 거절했어." };
  if (touchesGitDirectory(cwd, relative(cwd, path)) || buildsRepository(cwd, [path]))
    return { refusal: "git 저장소 파일은 바꾸지 않아서 거절했어." };

  const before = readCurrent(path);
  if (before === "unreadable" || (before !== null && isBinary(before)))
    return { refusal: "보여줄 수 없는 파일(너무 크거나 바이너리)이라 거절했어." };

  let after: string;
  if (toolName === "Write") {
    if (typeof input.content !== "string") return { refusal: "새 내용을 알 수 없어서 거절했어." };
    after = input.content;
  } else if (toolName === "Edit") {
    const oldText = input.old_string;
    const newText = input.new_string;
    if (typeof oldText !== "string" || typeof newText !== "string" || oldText === "")
      return { refusal: "바꿀 내용을 알 수 없어서 거절했어." };
    if (before === null) return { refusal: "없는 파일은 고칠 수 없어서 거절했어." };
    // Claude Code matches CRLF files with plain newlines and writes CRLF back, so do the same.
    const crlf = before.includes("\r\n");
    const toLf = (text: string) => (crlf ? text.replace(/\r\n/g, "\n") : text);
    const text = toLf(before);
    const search = toLf(oldText);
    const replacement = toLf(newText);
    const matches = count(text, search);
    if (matches === 0) return { refusal: "바꿀 부분을 파일에서 찾지 못해서 거절했어." };
    let changed: string;
    if (input.replace_all === true) changed = text.split(search).join(replacement);
    else if (matches === 1) changed = text.replace(search, () => replacement);
    else return { refusal: "바꿀 부분이 여러 곳이라 어느 것인지 알 수 없어서 거절했어." };
    after = crlf ? changed.replace(/\n/g, "\r\n") : changed;
  } else return { refusal: "이 도구는 허용하지 않아." };

  if (isBinary(after) || Buffer.byteLength(after) > MAX_FILE_BYTES)
    return { refusal: "보여줄 수 없는 내용(너무 크거나 바이너리)이라 거절했어." };
  if (after === before) return { refusal: "바뀌는 내용이 없어서 건너뛰었어." };
  return {
    path,
    before,
    after,
    change: before === null ? `add:\n${after}` : `update:\n${unifiedDiff(before, after)}`,
  };
}

function lines(text: string): string[] {
  const parts = text.replace(/\r\n/g, "\n").split("\n");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

/** A unified diff body (hunks with 3 lines of context), without file headers. */
export function unifiedDiff(before: string, after: string): string {
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  // Lines of the changed middle, each " ", "-", or "+", from a longest-common-subsequence walk.
  const ops: string[] = [];
  if (midA.length * midB.length > MAX_DIFF_CELLS) {
    for (const line of midA) ops.push(`-${line}`);
    for (const line of midB) ops.push(`+${line}`);
  } else {
    const table: number[][] = Array.from({ length: midA.length + 1 }, () =>
      new Array<number>(midB.length + 1).fill(0),
    );
    for (let i = midA.length - 1; i >= 0; i -= 1)
      for (let j = midB.length - 1; j >= 0; j -= 1)
        table[i][j] =
          midA[i] === midB[j]
            ? table[i + 1][j + 1] + 1
            : Math.max(table[i + 1][j], table[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
        ops.push(` ${midA[i]}`);
        i += 1;
        j += 1;
      } else if (i < midA.length && (j === midB.length || table[i + 1][j] >= table[i][j + 1])) {
        ops.push(`-${midA[i]}`);
        i += 1;
      } else {
        ops.push(`+${midB[j]}`);
        j += 1;
      }
    }
  }

  const all = [
    ...a.slice(0, start).map((line) => ` ${line}`),
    ...ops,
    ...a.slice(endA).map((line) => ` ${line}`),
  ];
  // Keep changed lines with their context; long unchanged runs become hunk breaks.
  const keep = all.map((line) => !line.startsWith(" "));
  const shown = all.map((_, index) => {
    for (
      let k = Math.max(0, index - CONTEXT_LINES);
      k <= Math.min(all.length - 1, index + CONTEXT_LINES);
      k += 1
    )
      if (keep[k]) return true;
    return false;
  });
  const out: string[] = [];
  let inHunk = false;
  for (let index = 0; index < all.length; index += 1) {
    if (!shown[index]) {
      inHunk = false;
      continue;
    }
    if (!inHunk) out.push("@@");
    inHunk = true;
    out.push(all[index]);
  }
  // A change to only the final newline has no changed lines; say so instead of an empty diff.
  if (before.endsWith("\n") !== after.endsWith("\n"))
    out.push(after.endsWith("\n") ? "+(파일 끝 줄바꿈 추가)" : "-(파일 끝 줄바꿈 삭제)");
  return out.join("\n");
}
