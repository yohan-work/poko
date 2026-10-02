export type DiffLineKind = "add" | "remove" | "hunk" | "context";

export interface ParsedChange {
  kind: "add" | "update" | "delete" | "unknown";
  /** `n` is the line's position, a stable key for rendering. */
  lines: Array<{ n: number; kind: DiffLineKind; text: string }>;
  added: number;
  removed: number;
}

/**
 * Reads a change as the provider formats it (`kind:\n<diff>`). An added file's text is all
 * additions and a deleted file's text all removals; an update is a unified diff.
 */
export function parseChange(change: string): ParsedChange {
  const newline = change.indexOf("\n");
  const head = newline === -1 ? change : change.slice(0, newline);
  const body = newline === -1 ? "" : change.slice(newline + 1);
  const kindName = head.replace(/:$/, "");
  const kind =
    kindName === "add" || kindName === "update" || kindName === "delete" ? kindName : "unknown";
  const raw = body.endsWith("\n") ? body.slice(0, -1) : body;
  const lines = raw === "" ? [] : raw.split("\n");
  const parsed = lines.map((text, n): ParsedChange["lines"][number] => {
    if (kind === "add") return { n, kind: "add", text: `+${text}` };
    if (kind === "delete") return { n, kind: "remove", text: `-${text}` };
    if (text.startsWith("@@")) return { n, kind: "hunk", text };
    if (text.startsWith("+") && !text.startsWith("+++")) return { n, kind: "add", text };
    if (text.startsWith("-") && !text.startsWith("---")) return { n, kind: "remove", text };
    return { n, kind: "context", text };
  });
  return {
    kind,
    lines: parsed,
    added: parsed.filter((line) => line.kind === "add").length,
    removed: parsed.filter((line) => line.kind === "remove").length,
  };
}

/** A path inside the workspace, shown relative to it; anything else is shown as given. */
export function relativePath(path: string, root: string | null): string {
  if (!root) return path;
  const base = root.endsWith("/") ? root : `${root}/`;
  return path.startsWith(base) ? path.slice(base.length) : path;
}
