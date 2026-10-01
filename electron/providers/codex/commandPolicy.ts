/**
 * Which escalated commands Poko may offer for one-time approval.
 *
 * An approved command runs outside the read-only sandbox, so this is an allowlist that fails
 * closed. Phase 04 keeps general shell access unavailable: only a small set of local file,
 * build, test, and git commands is ever offered, and everything else is declined without asking.
 *
 * What is offered:
 * - The single `<shell> -c '<command>'` wrapper Codex uses is unwrapped once.
 * - Shell syntax is limited to plain words, quotes, `&&`, `||`, `;`, `|`, and `>`/`>>` into
 *   the workspace. Anything that expands or builds commands is declined: `$`, backticks,
 *   braces, globs, parentheses, backslashes outside quotes, `!`, `~`, and line breaks.
 * - Each segment must start with an allowed program, as a bare name, and pass its argument rules.
 * - Path arguments and redirect targets must stay relative: no leading `/` or `~`, no `..`.
 *   `/dev/null` is the one exception.
 *
 * This still isn't containment: allowed tools can run project code (`pnpm test`, `node x.js`),
 * so the approval card warns that the command runs outside the sandbox.
 */

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

interface Token {
  text: string;
  quoted: boolean;
}

type Rule = (args: Token[]) => string | null;

function pathLike(text: string): string | null {
  if (text === "/dev/null") return null;
  if (text.includes("://")) return "network";
  const parts = text.split("/");
  if (text.startsWith("/") || text.startsWith("~") || parts.includes(".."))
    return "path outside the workspace";
  // Git config and hooks run programs, so nothing inside .git is touched.
  if (parts.includes(".git")) return "git internals";
  return null;
}

/**
 * Every argument must stay inside the workspace, including option values written as
 * `--option=value` or attached to a short option (`-o/tmp/x`).
 */
function checkPaths(args: Token[]): string | null {
  for (const arg of args) {
    const text = arg.text;
    const candidates = text.startsWith("-")
      ? [text.split("=").slice(1).join("="), text.startsWith("--") ? "" : text.slice(2)]
      : [text];
    for (const value of candidates) {
      const reason = value ? pathLike(value) : null;
      if (reason) return reason;
    }
  }
  return null;
}

const positional = (args: Token[]) => args.filter((arg) => !arg.text.startsWith("-"));
const has = (args: Token[], ...flags: string[]) => args.some((arg) => flags.includes(arg.text));

const fileTool: Rule = checkPaths;

const rm: Rule = (args) =>
  args.some((arg) => /^-[a-z]*r/i.test(arg.text) || arg.text === "--recursive")
    ? "recursive delete"
    : checkPaths(args);

/** `node file.js` or `python3 script.py`; inline code (`-e`, `-c`, `-m`) is not offered. */
const scriptRunner: Rule = (args) =>
  args[0] && !args[0].text.startsWith("-") ? checkPaths(args) : "inline code";

const JS_SUBCOMMANDS = new Set([
  "run",
  "test",
  "start",
  "build",
  "lint",
  "typecheck",
  "format",
  "check",
]);
/**
 * Project scripts only: installs, publishing, and package downloads are not offered. The
 * subcommand must come first, so an option value (`--filter test add`) can't pose as one.
 */
const jsPackageManager: Rule = (args) => {
  const subcommand = args[0]?.text;
  if (!subcommand || !JS_SUBCOMMANDS.has(subcommand)) return "install or publish";
  return checkPaths(args);
};

const subcommandOnly =
  (allowed: string[]): Rule =>
  (args) => {
    const subcommand = args[0]?.text;
    return subcommand && allowed.includes(subcommand) ? checkPaths(args) : "not offered";
  };

const GIT_SUBCOMMANDS = new Set(
  "status diff log show add commit mv rm branch checkout switch stash tag blame rev-parse ls-files describe shortlog init".split(
    " ",
  ),
);
const git: Rule = (args) => {
  const deny = "git remote or discard";
  let index = 0;
  // Only output options are allowed before the subcommand: `-C` could point outside the
  // workspace and inline config could run programs.
  while (index < args.length && args[index].text.startsWith("-")) {
    const text = args[index].text;
    if (text !== "--no-pager" && text !== "--no-optional-locks") return deny;
    index += 1;
  }
  const subcommand = args[index]?.text;
  const rest = args.slice(index + 1);
  if (!subcommand || !GIT_SUBCOMMANDS.has(subcommand)) return deny;
  const pos = positional(rest);
  if (
    (subcommand === "checkout" &&
      (has(rest, ".", "--", "-f", "--force", "-p", "--patch") ||
        pos.length > (has(rest, "-b", "-B") ? 2 : 1))) ||
    (subcommand === "switch" && has(rest, "-f", "--force", "--discard-changes")) ||
    (subcommand === "branch" && has(rest, "-d", "-D", "--delete", "-m", "-M", "-f", "--force")) ||
    (subcommand === "stash" && has(rest, "drop", "clear", "pop")) ||
    (subcommand === "commit" && has(rest, "--amend")) ||
    (subcommand === "rm" &&
      rest.some((arg) => /^-[a-z]*[rf]/i.test(arg.text) || arg.text === "--force")) ||
    (subcommand === "tag" && has(rest, "-d", "--delete", "-f", "--force")) ||
    // Options that hand output to an external program.
    rest.some((arg) => /^(--ext-diff|--open-files-in-pager|-O|--exec|--upload-pack)/.test(arg.text))
  )
    return deny;
  return checkPaths(args.slice(index));
};

const PROGRAMS: Record<string, Rule> = {
  // Files and text inside the workspace.
  printf: fileTool,
  echo: fileTool,
  cat: fileTool,
  ls: fileTool,
  mkdir: fileTool,
  touch: fileTool,
  cp: fileTool,
  mv: fileTool,
  head: fileTool,
  tail: fileTool,
  wc: fileTool,
  sort: fileTool,
  uniq: fileTool,
  diff: fileTool,
  cmp: fileTool,
  grep: fileTool,
  pwd: fileTool,
  true: fileTool,
  false: fileTool,
  test: fileTool,
  rm,
  // Running and checking the project.
  node: scriptRunner,
  python: scriptRunner,
  python3: scriptRunner,
  npm: jsPackageManager,
  pnpm: jsPackageManager,
  yarn: jsPackageManager,
  bun: jsPackageManager,
  tsc: fileTool,
  eslint: fileTool,
  prettier: fileTool,
  biome: fileTool,
  vitest: fileTool,
  jest: fileTool,
  mocha: fileTool,
  pytest: fileTool,
  make: fileTool,
  go: subcommandOnly(["test", "build", "vet", "fmt"]),
  cargo: subcommandOnly(["test", "build", "check", "fmt", "clippy"]),
  git,
};

/**
 * Splits a line into segments of tokens. Returns a reason instead when the line uses shell
 * syntax outside the small allowed set.
 */
function parse(line: string): Token[][] | string {
  const segments: Token[][] = [];
  let segment: Token[] = [];
  let text = "";
  let quoted = false;
  let started = false;
  let quote: '"' | "'" | null = null;
  const endToken = () => {
    if (started) segment.push({ text, quoted });
    text = "";
    quoted = false;
    started = false;
  };
  const endSegment = () => {
    endToken();
    if (segment.length === 0) return false;
    segments.push(segment);
    segment = [];
    return true;
  };

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      else text += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "\\" && '$`"\\'.includes(line[index + 1] ?? "")) {
        // POSIX: inside double quotes a backslash escapes only these characters.
        text += line[index + 1];
        index += 1;
      } else if (char === "$" || char === "`") return "shell syntax";
      else text += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      quoted = true;
      started = true;
      continue;
    }
    if (char === " " || char === "\t") {
      endToken();
      continue;
    }
    if (char === ";" || char === "|" || char === "&") {
      // `&&`, `||`, `|`, and `;` separate commands; a lone `&` (background) is not offered.
      const pair = line[index + 1] === char && char !== ";";
      if (char === "&" && !pair) return "shell syntax";
      if (!endSegment()) return "shell syntax";
      if (pair) index += 1;
      continue;
    }
    if (char === ">") {
      endToken();
      const append = line[index + 1] === ">";
      segment.push({ text: append ? ">>" : ">", quoted: false });
      if (append) index += 1;
      continue;
    }
    if (/[$`{}*?[\]()\\!~<\n\r#=]/.test(char) && !(char === "=" && started)) return "shell syntax";
    text += char;
    started = true;
  }
  if (quote) return "shell syntax";
  endSegment();
  return segments;
}

function checkSegment(tokens: Token[]): string | null {
  // Redirection is allowed only as `> file` / `>> file` (optionally `2>`) into the workspace.
  const words: Token[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.quoted && (token.text === ">" || token.text === ">>")) {
      const target = tokens[index + 1];
      if (!target || target.text === ">" || target.text === ">>") return "shell syntax";
      const reason = pathLike(target.text);
      if (reason) return reason;
      index += 1;
      continue;
    }
    const next = tokens[index + 1];
    if (
      !token.quoted &&
      /^\d$/.test(token.text) &&
      next &&
      !next.quoted &&
      next.text.startsWith(">")
    )
      continue;
    words.push(token);
  }
  const [program, ...args] = words;
  if (!program || program.quoted) return "not offered";
  // Program names are bare words: no paths and no assignments.
  if (/[/=]/.test(program.text)) return "not offered";
  const rule = Object.hasOwn(PROGRAMS, program.text) ? PROGRAMS[program.text] : undefined;
  return rule ? rule(args) : "not offered";
}

function checkLine(line: string): string | null {
  const segments = parse(line);
  if (typeof segments === "string") return segments;
  if (segments.length === 0) return "not offered";
  for (const tokens of segments) {
    const reason = checkSegment(tokens);
    if (reason) return reason;
  }
  return null;
}

/** The reason a command is not offered for approval, or null when it may be shown. */
export function deniedCommandReason(command: string): string | null {
  // Unwrap the single `<shell> -c '<command>'` wrapper Codex uses, once.
  const outer = parse(command);
  if (typeof outer !== "string" && outer.length === 1 && outer[0].length === 3) {
    const [shell, flag, inner] = outer[0];
    // Only a system shell: a bare name, /bin/<shell>, or /usr/bin/<shell>, never a file in the workspace.
    const match = /^(?:\/bin\/|\/usr\/bin\/)?([a-z]+)$/.exec(shell.text);
    if (!shell.quoted && match && SHELLS.has(match[1]) && /^-[a-z]*c[a-z]*$/.test(flag.text))
      return checkLine(inner.text);
  }
  return checkLine(command);
}
