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
  const lower = parts.map((part) => part.toLowerCase());
  if (text.startsWith("/") || text.startsWith("~") || parts.includes(".."))
    return "path outside the workspace";
  // Git config and hooks run programs, so nothing inside .git is touched. Case-insensitive,
  // because the default macOS file system resolves `.GIT` to `.git`.
  if (lower.includes(".git")) return "git internals";
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

/** The shell strips quotes, so a quoted `"--amend"` is still a flag to the program. */
const isFlag = (arg: Token) => arg.text.startsWith("-") && arg.text.length > 1;

interface ProgramSpec {
  /** The only flags accepted, matched exactly; anything else fails closed. */
  flags?: string[];
  /** Also accept numeric flags such as `-20` (head, tail). */
  numericFlags?: boolean;
  /** The first argument must be one of these. */
  subcommands?: string[];
  maxPositional?: number;
  /** Arguments after `--` go to the project's own script and aren't screened as flags. */
  scriptArgsAfterDashes?: boolean;
  /** Reject `NAME=value` arguments (make variables can replace its shell). */
  noAssignments?: boolean;
  /** The first argument must be a file, not inline code. */
  needsFile?: boolean;
}

function specRule(spec: ProgramSpec): Rule {
  return (args) => {
    const dashes = spec.scriptArgsAfterDashes ? args.findIndex((arg) => arg.text === "--") : -1;
    const own = dashes === -1 ? args : args.slice(0, dashes);
    if (spec.subcommands && !spec.subcommands.includes(own[0]?.text ?? "")) return "not offered";
    if (spec.needsFile && (!own[0] || isFlag(own[0]))) return "inline code";
    for (const arg of own) {
      if (!isFlag(arg)) continue;
      if (spec.numericFlags && /^-\d+$/.test(arg.text)) continue;
      if (!spec.flags?.includes(arg.text)) return "option not offered";
    }
    const positional = own.filter((arg) => !isFlag(arg));
    if (spec.maxPositional !== undefined && positional.length > spec.maxPositional)
      return "not offered";
    if (spec.noAssignments && positional.some((arg) => arg.text.includes("=")))
      return "not offered";
    return checkPaths(args);
  };
}

const JS_SCRIPT: ProgramSpec = {
  subcommands: ["run", "test", "start", "build", "lint", "typecheck", "format", "check"],
  scriptArgsAfterDashes: true,
};

/**
 * git subcommands Poko may offer, each with the only flags it accepts. Flags are matched
 * exactly, so bundled or abbreviated spellings (`-Dq`, `--amen`) fail closed. Positional limits
 * keep each command to its harmless form.
 */
const GIT_RULES: Record<string, { flags: string[]; maxPositional?: number; needsFlag?: string[] }> =
  {
    status: { flags: ["-s", "--short", "-b", "--branch", "--porcelain"] },
    diff: {
      flags: ["--stat", "--cached", "--staged", "--name-only", "--name-status", "--no-color"],
    },
    log: { flags: ["--oneline", "--stat", "--graph", "--no-color", "-p", "--patch"] },
    show: { flags: ["--stat", "--name-only", "--no-color"] },
    blame: { flags: [] },
    shortlog: { flags: ["-s", "-n", "-sn"] },
    "ls-files": { flags: [] },
    "rev-parse": { flags: ["--abbrev-ref", "--show-toplevel", "--short"] },
    add: { flags: ["-A", "--all", "-u", "--update", "-v", "--verbose", "-N"] },
    commit: {
      flags: ["-m", "--message", "-a", "--all", "-am", "-q", "--quiet", "-s", "--signoff"],
    },
    mv: { flags: ["-v"] },
    rm: { flags: ["--cached", "-q", "--quiet"] },
    // Listing or creating a branch; deleting, renaming, or forcing is not offered.
    branch: { flags: ["-a", "--all", "-v", "--list", "--show-current"], maxPositional: 1 },
    // Switching branches; `checkout` is offered only to create one, since it can't tell a
    // branch name from a path that would be overwritten.
    switch: { flags: ["-c", "--create"], maxPositional: 2 },
    checkout: { flags: ["-b"], maxPositional: 2, needsFlag: ["-b"] },
    stash: { flags: ["-m", "--message", "-u", "--include-untracked"], maxPositional: 1 },
    tag: { flags: ["-a", "-m", "--message", "-l", "--list"], maxPositional: 1 },
  };
const STASH_SUBCOMMANDS = new Set(["push", "list", "show"]);
/** git subcommands that run repository hooks. */
const GIT_HOOK_SUBCOMMANDS = new Set(["commit", "switch", "checkout"]);

function gitSubcommand(args: Token[]): string | undefined {
  return args.find((arg) => !isFlag(arg))?.text;
}

const git: Rule = (args) => {
  const deny = "git remote or discard";
  let index = 0;
  // Only output options are allowed before the subcommand: `-C` could point outside the
  // workspace and inline config could run programs.
  while (index < args.length && isFlag(args[index])) {
    const text = args[index].text;
    if (text !== "--no-pager" && text !== "--no-optional-locks") return deny;
    index += 1;
  }
  const subcommand = args[index]?.text;
  const rule = subcommand && Object.hasOwn(GIT_RULES, subcommand) ? GIT_RULES[subcommand] : null;
  if (!rule) return deny;
  const rest = args.slice(index + 1);
  // The word after `-m` or `--message` is the message, even if it starts with "-".
  const values = new Set<Token>();
  rest.forEach((arg, position) => {
    if (["-m", "--message", "-am"].includes(arg.text) && rest[position + 1])
      values.add(rest[position + 1]);
  });
  const flags = rest.filter((arg) => !values.has(arg) && isFlag(arg));
  const positionals = rest.filter((arg) => !values.has(arg) && !isFlag(arg));
  if (flags.some((flag) => !rule.flags.includes(flag.text))) return deny;
  if (rule.needsFlag && !flags.some((flag) => rule.needsFlag?.includes(flag.text))) return deny;
  if (rule.maxPositional !== undefined && positionals.length > rule.maxPositional) return deny;
  if (subcommand === "stash" && positionals[0] && !STASH_SUBCOMMANDS.has(positionals[0].text))
    return deny;
  return checkPaths(rest.filter((arg) => !values.has(arg)));
};

/** `rm` of files only: any flag other than `-f` (recursive, interactive tricks) is declined. */
const rm: Rule = (args) => {
  if (args.some((arg) => isFlag(arg) && arg.text !== "-f")) return "recursive delete";
  return checkPaths(args);
};

/** Every allowed program, each with the only flags it accepts. */
const PROGRAMS: Record<string, Rule> = {
  // Files and text inside the workspace.
  printf: specRule({}),
  echo: specRule({ flags: ["-n", "-e"] }),
  cat: specRule({ flags: ["-n"] }),
  ls: specRule({ flags: ["-l", "-a", "-la", "-al", "-1", "-R", "-lh"] }),
  mkdir: specRule({ flags: ["-p"] }),
  touch: specRule({}),
  cp: specRule({ flags: ["-r", "-R"] }),
  mv: specRule({}),
  head: specRule({ flags: ["-n"], numericFlags: true }),
  tail: specRule({ flags: ["-n"], numericFlags: true }),
  wc: specRule({ flags: ["-l", "-w", "-c"] }),
  sort: specRule({ flags: ["-r", "-n", "-u"] }),
  uniq: specRule({ flags: ["-c", "-d", "-u"], maxPositional: 1 }),
  diff: specRule({ flags: ["-u", "-r", "-q"] }),
  cmp: specRule({}),
  grep: specRule({ flags: ["-n", "-i", "-r", "-l", "-c", "-v", "-E", "-F", "-w"] }),
  pwd: specRule({}),
  true: specRule({}),
  false: specRule({}),
  rm,
  // Running and checking the project. Their options can load plugins or run programs, so
  // only a few output switches are accepted.
  node: specRule({ needsFile: true }),
  python: specRule({ needsFile: true }),
  python3: specRule({ needsFile: true }),
  npm: specRule(JS_SCRIPT),
  pnpm: specRule(JS_SCRIPT),
  yarn: specRule(JS_SCRIPT),
  bun: specRule(JS_SCRIPT),
  tsc: specRule({ flags: ["--noEmit"] }),
  eslint: specRule({ flags: ["--fix"] }),
  prettier: specRule({ flags: ["--check", "--write"] }),
  biome: specRule({ subcommands: ["check", "lint", "format"], flags: ["--write"] }),
  vitest: specRule({ flags: ["--run"] }),
  jest: specRule({}),
  mocha: specRule({}),
  pytest: specRule({ flags: ["-q", "-x", "-v"] }),
  make: specRule({ noAssignments: true }),
  go: specRule({ subcommands: ["test", "build", "vet", "fmt"] }),
  cargo: specRule({ subcommands: ["test", "build", "check", "fmt", "clippy"] }),
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

/** Programs that run project code or project configuration. */
const RUNNERS = new Set(
  "node python python3 npm pnpm yarn bun make go cargo tsc eslint prettier biome vitest jest mocha pytest".split(
    " ",
  ),
);
/** Programs that create or replace files. */
const WRITERS = new Set(["cp", "mv", "touch"]);

interface SegmentResult {
  reason: string | null;
  /** Runs project code, configuration, or hooks. */
  runs?: boolean;
  writes: boolean;
}

function checkSegment(tokens: Token[]): SegmentResult {
  // Redirection is allowed only as `> file` / `>> file` (optionally `2>`) into the workspace.
  const words: Token[] = [];
  let writes = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.quoted && (token.text === ">" || token.text === ">>")) {
      const target = tokens[index + 1];
      if (!target || target.text === ">" || target.text === ">>")
        return { reason: "shell syntax", writes };
      const reason = pathLike(target.text);
      if (reason) return { reason, writes };
      if (target.text !== "/dev/null") writes = true;
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
  if (!program || program.quoted) return { reason: "not offered", writes };
  // Program names are bare words: no paths and no assignments.
  if (/[/=]/.test(program.text)) return { reason: "not offered", writes };
  const rule = Object.hasOwn(PROGRAMS, program.text) ? PROGRAMS[program.text] : undefined;
  const runsHooks = program.text === "git" && GIT_HOOK_SUBCOMMANDS.has(gitSubcommand(args) ?? "");
  return {
    reason: rule ? rule(args) : "not offered",
    runs: RUNNERS.has(program.text) || runsHooks,
    writes: writes || WRITERS.has(program.text),
  };
}

function checkLine(line: string): string | null {
  const segments = parse(line);
  if (typeof segments === "string") return segments;
  if (segments.length === 0) return "not offered";
  const results = segments.map(checkSegment);
  const denied = results.find((result) => result.reason);
  if (denied) return denied.reason;
  // Writing a file and running project code in one command would let any code through the
  // allowlist (`printf … > a.js && node a.js`), so that pairing is declined.
  // A runner saving its own output (`pnpm test > out.txt`) is fine on its own.
  const isRunner = (result: SegmentResult) => Boolean(result.runs);
  const runners = results.filter(isRunner);
  const otherWrites = results.some((result) => result.writes && !isRunner(result));
  const runnerWrites = runners.some((result) => result.writes);
  if (runners.length > 0 && (otherWrites || (runnerWrites && runners.length > 1)))
    return "write and run";
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
