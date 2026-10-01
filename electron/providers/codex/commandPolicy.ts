/**
 * Best-effort screen for commands Poko never offers for approval: network access, package
 * installs and publishing, deployment, git operations that reach a remote or discard work,
 * privilege escalation, recursive deletion, and disk tools. Phase 04 keeps these unavailable.
 *
 * This is defense in depth, not containment. A shell can hide intent (variables, eval, scripts),
 * so an approved command still runs outside the sandbox and the approval card says so.
 *
 * The screen is deliberately conservative: it splits the command into segments and checks every
 * token position (so wrappers like `zsh -lc "…"`, `xargs rm`, and `python -m pip` are covered),
 * and compares program names without their directory (`/bin/rm` is `rm`). A false positive only
 * means a request is declined instead of offered.
 */

const NETWORK = new Set(
  "curl wget ssh scp sftp rsync nc ncat netcat telnet ftp socat http https httpie aria2c".split(
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
const JS_INSTALL_SUBCOMMANDS = new Set(
  "install i ci add publish update upgrade up dlx exec x create init link remove rm uninstall".split(
    " ",
  ),
);
const OTHER_PACKAGE_MANAGERS = new Set("pip pip3 gem cargo go".split(" "));
const OTHER_INSTALL_SUBCOMMANDS = new Set(
  "install download add publish get update upgrade uninstall".split(" "),
);
const GIT_DENIED_SUBCOMMANDS = new Set(
  "push pull fetch clone remote reset clean rebase restore submodule gc prune filter-branch filter-repo worktree".split(
    " ",
  ),
);
/** git options that take a separate value, so the value is not mistaken for the subcommand. */
const GIT_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

function programName(token: string): string {
  return (token.split("/").pop() ?? token).toLowerCase();
}

/**
 * Shell-ish split. Quotes and backslashes are removed (not replaced), because the shell joins
 * the pieces back together: `r"m"` runs `rm`. Operators and subshell markers end a segment.
 */
function segments(command: string): string[][] {
  return command
    .replace(/["'\\]/g, "")
    .split(/&&|\|\||\$\(|[;&|\n()`{}]/)
    .map((segment) => segment.trim().split(/\s+/).filter(Boolean))
    .filter((tokens) => tokens.length > 0);
}

function firstArgument(rest: string[]): string | undefined {
  return rest.find((token) => !token.startsWith("-"));
}

function gitSubcommand(rest: string[]): { subcommand?: string; args: string[] } {
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (GIT_OPTIONS_WITH_VALUE.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    return { subcommand: token.toLowerCase(), args: rest.slice(index + 1) };
  }
  return { args: [] };
}

function gitReason(rest: string[]): string | null {
  const { subcommand, args } = gitSubcommand(rest);
  if (!subcommand) return null;
  if (GIT_DENIED_SUBCOMMANDS.has(subcommand)) return "git remote or discard";
  const has = (...flags: string[]) => args.some((arg) => flags.includes(arg));
  if (subcommand === "checkout" && has(".", "--", "-f", "--force")) return "git remote or discard";
  if (subcommand === "switch" && has("-f", "--force", "--discard-changes"))
    return "git remote or discard";
  if (subcommand === "branch" && has("-D", "-d", "--delete", "-M", "-f", "--force"))
    return "git remote or discard";
  if (subcommand === "stash" && has("drop", "clear")) return "git remote or discard";
  if (subcommand === "tag" && has("-d", "--delete")) return "git remote or discard";
  return null;
}

function reasonAt(name: string, rest: string[]): string | null {
  if (NETWORK.has(name)) return "network";
  if (PRIVILEGE.has(name)) return "privilege";
  if (DISK.has(name) || name.startsWith("mkfs")) return "disk";
  if (DEPLOY.has(name)) return "deployment";
  if (ALWAYS_INSTALL.has(name)) return "install or publish";
  // Install subcommands are matched anywhere after the program, so option values such as
  // `--filter web` or `--prefix .` cannot hide them.
  const words = rest.map((token) => token.toLowerCase());
  if (JS_PACKAGE_MANAGERS.has(name)) {
    // A bare `yarn` installs dependencies.
    if (name === "yarn" && !firstArgument(rest)) return "install or publish";
    if (words.some((word) => JS_INSTALL_SUBCOMMANDS.has(word))) return "install or publish";
  }
  if (OTHER_PACKAGE_MANAGERS.has(name) && words.some((word) => OTHER_INSTALL_SUBCOMMANDS.has(word)))
    return "install or publish";
  if (name === "git") return gitReason(rest);
  if (name === "rm" && rest.some((arg) => /^-[a-z]*r/i.test(arg) || arg === "--recursive"))
    return "recursive delete";
  if (name === "find" && rest.includes("-delete")) return "recursive delete";
  return null;
}

/** The reason a command is never offered for approval, or null when it may be shown. */
export function deniedCommandReason(command: string): string | null {
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(command)) return "network";
  for (const tokens of segments(command)) {
    for (let index = 0; index < tokens.length; index += 1) {
      const reason = reasonAt(programName(tokens[index]), tokens.slice(index + 1));
      if (reason) return reason;
    }
  }
  return null;
}
