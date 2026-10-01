/**
 * Best-effort screen for commands Poko never offers for approval: network and remote-service
 * access, package installs and publishing, deployment, git operations that reach a remote or
 * discard work, privilege escalation, recursive deletion, and disk tools. Phase 04 keeps these
 * unavailable.
 *
 * This is defense in depth, not containment. A shell can hide intent (variables, eval of built
 * strings, aliases, scripts written then run), so an approved command still runs outside the
 * sandbox and the approval card says so.
 *
 * How it reads a command:
 * - A small quote-aware tokenizer joins adjacent fragments the way the shell does (`r"m"` is
 *   `rm`) and keeps a quoted argument as one token, so a commit message is not read as commands.
 * - Strings run by a shell (`sh -c "…"`, `zsh -lc "…"`, `eval "…"`) and `$(…)` are screened
 *   as commands too.
 * - Every unquoted token position is checked, so `xargs rm`, `find -exec rm`, and
 *   `python -m pip` are covered. Directories are stripped only from paths that look like
 *   executables (`/bin/rm`, `./x`, `~/x`), not from arguments like `src/docker`.
 * A false positive only means a request is declined instead of offered.
 */

const NETWORK = new Set(
  "curl wget ssh scp sftp rsync nc ncat netcat telnet ftp socat http https httpie aria2c gh glab hub".split(
    " ",
  ),
);
const PRIVILEGE = new Set("sudo su doas chown".split(" "));
const DISK = new Set("mkfs dd diskutil shutdown reboot halt launchctl".split(" "));
const DEPLOY = new Set(
  "vercel netlify firebase flyctl fly heroku kubectl terraform helm aws gcloud az docker podman".split(
    " ",
  ),
);
/** Tools that fetch and run packages whatever the arguments. */
const ALWAYS_INSTALL = new Set(
  "npx bunx pnpx uv uvx pipx brew apt apt-get yum dnf corepack".split(" "),
);
const JS_PACKAGE_MANAGERS = new Set("npm pnpm yarn bun".split(" "));
const JS_INSTALL_WORDS = new Set(
  "install i ci add publish unpublish deprecate dist-tag owner login adduser token update upgrade up dlx exec x create init link remove rm uninstall".split(
    " ",
  ),
);
/** Script runners: arguments after these belong to the project's script, not the manager. */
const JS_SCRIPT_RUNNERS = new Set("run run-script test start".split(" "));
const OTHER_PACKAGE_MANAGERS = new Set(
  "pip gem cargo go poetry pdm pipenv bundle bundler composer conda mamba hatch rye".split(" "),
);
const OTHER_INSTALL_WORDS = new Set(
  "install download add publish get sync lock update upgrade uninstall remove".split(" "),
);
const GIT_DENIED_SUBCOMMANDS = new Set(
  "push pull fetch clone remote reset clean rebase restore submodule gc prune filter-branch filter-repo worktree".split(
    " ",
  ),
);
/** git options that take a separate value, so the value is not mistaken for the subcommand. */
const GIT_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
const SHELLS = new Set("sh bash zsh dash ksh fish".split(" "));

interface Token {
  text: string;
  quoted: boolean;
}

/** Splits a command into segments of tokens, honoring quotes and backslash escapes. */
function tokenize(command: string): { segments: Token[][]; substitutions: string[] } {
  const segments: Token[][] = [];
  const substitutions: string[] = [];
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
    if (segment.length > 0) segments.push(segment);
    segment = [];
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];
    if (quote === "'") {
      if (char === "'") quote = null;
      else text += char;
      continue;
    }
    if (char === "\\" && next !== undefined) {
      text += next;
      started = true;
      index += 1;
      continue;
    }
    if (char === "$" && next === "(") {
      // Screen the substitution as its own command, whether or not it is inside quotes.
      let depth = 1;
      let end = index + 2;
      while (end < command.length && depth > 0) {
        if (command[end] === "(") depth += 1;
        else if (command[end] === ")") depth -= 1;
        end += 1;
      }
      substitutions.push(command.slice(index + 2, depth === 0 ? end - 1 : end));
      text += "$";
      started = true;
      index = end - 1;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else text += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      quoted = true;
      started = true;
      continue;
    }
    if (char === "`") {
      const end = command.indexOf("`", index + 1);
      substitutions.push(command.slice(index + 1, end === -1 ? undefined : end));
      index = end === -1 ? command.length : end;
      continue;
    }
    if (
      char === "\n" ||
      char === ";" ||
      char === "&" ||
      char === "|" ||
      char === "(" ||
      char === ")"
    ) {
      endSegment();
      continue;
    }
    if (/\s/.test(char)) {
      endToken();
      continue;
    }
    text += char;
    started = true;
  }
  endSegment();
  return { segments, substitutions };
}

function programName(token: Token): string {
  const text = token.text.toLowerCase();
  const isPath = /^(\/|\.\.?\/|~\/)/.test(text);
  const name = isPath ? (text.split("/").pop() ?? text) : text;
  // pip3, pip3.12 -> pip
  return /^pip\d[\d.]*$/.test(name) ? "pip" : name;
}

/** A quoted argument containing spaces, such as a commit message. Single words still count. */
function isPhrase(token: Token): boolean {
  return token.quoted && /\s/.test(token.text);
}

function words(tokens: Token[]): string[] {
  return tokens.filter((token) => !isPhrase(token)).map((token) => token.text.toLowerCase());
}

function gitReason(rest: Token[]): string | null {
  let index = 0;
  while (index < rest.length) {
    const text = rest[index].text;
    if (GIT_OPTIONS_WITH_VALUE.has(text)) index += 2;
    else if (text.startsWith("-")) index += 1;
    else break;
  }
  const subcommand = rest[index]?.text.toLowerCase();
  if (!subcommand) return null;
  const after = words(rest.slice(index + 1));
  const has = (...flags: string[]) => after.some((arg) => flags.includes(arg));
  if (GIT_DENIED_SUBCOMMANDS.has(subcommand)) return "git remote or discard";
  if (subcommand === "checkout" && has(".", "--", "-f", "--force")) return "git remote or discard";
  if (subcommand === "switch" && has("-f", "--force", "--discard-changes"))
    return "git remote or discard";
  if (subcommand === "branch" && has("-d", "--delete", "-m", "-f", "--force"))
    return "git remote or discard";
  if (subcommand === "stash" && has("drop", "clear")) return "git remote or discard";
  if (subcommand === "tag" && has("-d", "--delete")) return "git remote or discard";
  return null;
}

function packageReason(name: string, rest: Token[]): string | null {
  const args = words(rest);
  if (JS_PACKAGE_MANAGERS.has(name)) {
    // A bare `yarn` installs dependencies.
    if (name === "yarn" && !args.some((arg) => !arg.startsWith("-"))) return "install or publish";
    // Options with values (`--filter web`) can precede the subcommand, so look at every word
    // until a script runner hands the rest to the project's own script.
    for (const arg of args) {
      if (arg === "--" || JS_SCRIPT_RUNNERS.has(arg)) break;
      if (JS_INSTALL_WORDS.has(arg)) return "install or publish";
    }
  }
  if (OTHER_PACKAGE_MANAGERS.has(name) && args.some((arg) => OTHER_INSTALL_WORDS.has(arg)))
    return "install or publish";
  return null;
}

function reasonAt(name: string, rest: Token[]): string | null {
  if (NETWORK.has(name)) return "network";
  if (PRIVILEGE.has(name)) return "privilege";
  if (DISK.has(name) || name.startsWith("mkfs")) return "disk";
  if (DEPLOY.has(name)) return "deployment";
  if (ALWAYS_INSTALL.has(name)) return "install or publish";
  const packages = packageReason(name, rest);
  if (packages) return packages;
  if (name === "git") return gitReason(rest);
  const args = words(rest);
  if (name === "rm" && args.some((arg) => /^-[a-z]*r/.test(arg) || arg === "--recursive"))
    return "recursive delete";
  if (
    name === "find" &&
    (args.includes("-delete") ||
      (args.some((arg) => ["-exec", "-execdir", "-ok", "-okdir"].includes(arg)) &&
        args.includes("rm")))
  )
    return "recursive delete";
  return null;
}

function screen(command: string, depth: number): string | null {
  if (depth > 4) return "nested shell";
  const { segments, substitutions } = tokenize(command);
  for (const substitution of substitutions) {
    const reason = screen(substitution, depth + 1);
    if (reason) return reason;
  }
  for (const tokens of segments) {
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      const previous = tokens[index - 1];
      // A string handed to a shell (`-c`, `-lc`) or to eval is itself a command.
      if (
        isPhrase(token) &&
        previous &&
        (/^-[a-z]*c$/.test(previous.text) || programName(previous) === "eval")
      ) {
        const reason = screen(token.text, depth + 1);
        if (reason) return reason;
        continue;
      }
      if (isPhrase(token)) continue;
      const name = programName(token);
      if (name === "eval" || SHELLS.has(name)) continue;
      const reason = reasonAt(name, tokens.slice(index + 1));
      if (reason) return reason;
    }
  }
  return null;
}

/** The reason a command is never offered for approval, or null when it may be shown. */
export function deniedCommandReason(command: string): string | null {
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(command)) return "network";
  return screen(command, 0);
}
