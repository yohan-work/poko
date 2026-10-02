# Phase 12 — Running commands with approval

## Goal

Let Poko run a project command, such as tests or a build, after the user approves that exact command, so it can fix code, run the tests, and fix again. Every approved command runs in a sandbox: it can write only inside the workspace (never `.git`) and gets no network.

## What we learned

The probes ran on 2026-10-02 in temp workspaces.

**Codex 0.160.0 can't do this safely.**
- An approved command runs **outside** the sandbox.
  - The setup was `sandboxPolicy: workspaceWrite` with `networkAccess: false` and `approvalPolicy: untrusted`.
  - After approval, `touch ~/outside/escaped.txt` and `touch .git/hooks/evil` both succeeded. Network was refused.
- The decisions offered are only `accept`, `acceptWithExecpolicyAmendment`, and `cancel`. None of them keeps the sandbox.
- The alternative policy (`on-request` with a writable workspace) runs commands with no approval at all. It would also let shell commands change files without a card or a checkpoint.
- So Poko keeps declining Codex command requests.

**Claude Code 2.1.287 can.**
- The setup was `--settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":false,"allowUnsandboxedCommands":false}}'` with `--tools Bash`.
- Each Bash call is still a `can_use_tool` request, so Poko shows the exact command and the user approves it.
- After approval, the command runs in Claude Code's macOS sandbox:
  - `node test.js` ran and wrote inside the workspace;
  - `touch ~/outside/…` and `touch .git/hooks/evil` failed with "Operation not permitted";
  - network access arrives as a separate `can_use_tool` request with `{ host }`.

**Follow-up probes after review.** These were run with the same CLI and settings unless noted.
- **Auto-run reads:** `ls` and `git status` ran **without** a request, because Claude Code auto-allows read-only commands. Adding `permissions.ask: ["Bash"]` made every Bash call ask, `ls` included.
- **Reading outside the workspace:**
  - An approved `cat ~/secret` printed the file, because the sandbox reads the whole disk by default.
  - `sandbox.filesystem.denyRead: [HOME]` with `allowRead: [workspace]` made that, and `ls ~/Documents`, fail with "Operation not permitted". Commands inside a workspace under the home folder, and `node`, still ran.
- **Temp folders:** `/tmp` writes failed.
- **Environment:** the CLI inherits the app's environment, 107 variables here. Starting it with a minimal environment left 60, the rest added by Claude Code itself.
- **Background:** `(sleep 30; touch late.txt) &` was approved and kept running after the task ended; it created `late.txt` in the workspace 30 seconds later. Sandbox rules are inherited, so such a process stays confined to the same limits.

**Second round of probes.**
- **Process groups:** killing the CLI's process group after it exited found no group (`ESRCH`), yet the background job still wrote `late.txt`. Claude Code runs each command in its own group, so neither the group nor the parent chain reaches orphaned jobs.
- **Narrower read limits:** with only sensitive folders denied (for example `~/.ssh`, `~/Documents`) and the workspace allowed, `npm test` worked with npm from nvm under the home folder.
- **Temp files:** Claude Code points `TMPDIR` at its own sandbox-writable temp folder (`/tmp/claude-<uid>`), so `os.tmpdir()` writes succeeded while other `/tmp` writes stay blocked.

**Third round of probes.**
- **Temp folder:** `CLAUDE_CODE_TMPDIR` moves the commands' `TMPDIR` into a folder Poko chooses, so a command no longer shares `/tmp/claude-<uid>` with other Claude Code sessions. Listing that shared folder still worked until reads of `/tmp` were denied too.
- **Allowlist:** with the whole home folder denied and only the workspace, `~/.nvm`, and `~/.npm` allowed, `npm test` worked.

## What the user experiences

- With **수정 허용** on and **Claude Code** as the engine, Poko can propose a command. A command card shows:
  - the exact command, the folder, and Claude's one-line description;
  - the note "작업 폴더에만 쓸 수 있고, 작업 폴더와 개발 도구 말고는 읽지 못하고, 인터넷은 쓸 수 없어. 명령이 바꾼 파일은 되돌리기로 복구되지 않아."
  - Approve runs it once; decline tells Claude not to.
- After it runs, Activity shows the command and its exit result. The output itself stays with Claude.
- **Read-only mode:** commands are never offered.
- **Codex:** command requests are declined with "Codex에서는 명령 실행을 아직 안전하게 할 수 없어. 설정에서 엔진을 Claude Code로 바꾸면 승인 후 샌드박스 안에서 실행할 수 있어."
- The 수정 허용 tooltip and the edits confirmation say that, on Claude Code, it also allows proposing commands.

## Design

The rule throughout: deny by default, then allow only what a project command needs. A tool that isn't allowed fails with "Operation not permitted", which is a safe failure.

- **Where it runs:**
  - Commands are offered only on macOS with Claude Code 2.1.287 or newer, the version these probes verified.
  - They are also refused when the workspace is the home folder, a folder above it, or a system folder, because allowing reads and writes there would reopen everything below it.
  - Anywhere else, Bash isn't offered. With edits on, Activity says once at the task's start: "이 환경에서는 명령 실행을 지원하지 않아." The 수정 허용 tooltip says commands need Claude Code on macOS.
- **Settings passed with `--settings`** (every settings file stays out with `--setting-sources ""`):
  - `permissions.ask: ["Bash"]`, so no command runs without a card, `ls` included;
  - `sandbox.enabled: true`, `autoAllowBashIfSandboxed: false`, `allowUnsandboxedCommands: false`;
  - `sandbox.filesystem.denyRead`: `/Users` (every home folder), `/Volumes` (external drives and backups), `/tmp`, `/private/tmp`, and `/private/var/folders`;
  - `allowRead`:
    - the workspace;
    - the task's temp folder;
    - known toolchain folders that exist: `~/.nvm`, `~/.fnm`, `~/.local/share/fnm`, `~/.volta`, `~/.asdf`, `~/.bun`, `~/.deno`, `~/.pyenv`, `~/.rbenv`, `~/.rustup`, `~/.cargo/bin`, `~/.local/bin`, `~/.local/share/pnpm`, `~/Library/pnpm`, `~/.npm`, `~/.cache/node`, `~/.cache/pnpm`, `~/.cache/yarn`, `~/.yarn`;
    - the folder of the `node` Poko found.
    - Credentials files are never in this list. `~/.cargo` is allowed only as `bin`, and `~/.cache` only for the subfolders above, because other tools keep tokens there (for example `~/.cache/huggingface/token`).
  - `sandbox.network.allowUnixSockets: []` and `allowLocalBinding: false`.
- **Temp folder:**
  - Each task gets its own folder under the app's temp directory, passed as `CLAUDE_CODE_TMPDIR`.
  - It is the only temp location commands can read or write, and it is removed when the task ends.
- **Environment:** an allowlist, not a filter.
  - Kept:
    - `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_*`, `TERM`, `CLAUDE_CODE_TMPDIR`;
    - Claude Code's own sign-in and settings variables (`ANTHROPIC_*`, `CLAUDE_*`);
    - proxy and certificate variables (`HTTP(S)_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_*`).
  - Cloud variables are kept only when Claude Code is set up to use that provider:
    - `AWS_*` when `CLAUDE_CODE_USE_BEDROCK` is set;
    - `GOOGLE_*`, `CLOUD_ML_*`, and `VERTEX_*` when `CLAUDE_CODE_USE_VERTEX` is set.
  - Everything else is dropped. What is kept remains visible to an approved `env`, which is documented.
- **Tools:**
  - When edits are on and commands are allowed, `ClaudeCodeProvider` adds `Bash` to `--tools`.
  - The init check allows `Bash` only then.
- **Permission policy** for Bash:
  - The input must carry a non-empty `command` (at most 2,000 characters).
  - It must not set `dangerouslyDisableSandbox`.
  - `run_in_background` is denied.
  - A `timeout` above 5 minutes is **denied, not clamped**, so the allowed input is always the original. Claude Code's own default is 2 minutes.
  - The card is `kind: "command"` with `canApprove: true`. Approve sends `allow` with the original input.
  - `canStillApprove` re-runs exactly these input checks and never consults `planEdit`.
- **Network:** a permission request with a `host` is always denied, with no card and an Activity note.
- **Same rules as file changes:** one-shot answers, the 5-minute approval timeout, and decline on cancel or task end. A command card has no file checkpoint.
- **Task timeout:** an **inactivity** timeout, 10 minutes without any event from the CLI, paused while a card waits for the user, so a fix, test, fix loop isn't cut off.
- **Leftover processes:**
  - Groups and parents don't reach orphaned jobs, so a new `poko-ax` command asks which of the user's processes belong to **this task**. That means both of these:
    - `sandbox_check(pid, NULL, 0)` reports the process as sandboxed (verified: 1 for a `sandbox-exec` process, 0 otherwise);
    - its environment, read with `KERN_PROCARGS2`, carries this task's own `CLAUDE_CODE_TMPDIR`.
  - The second check keeps sandboxed commands from the user's own Claude Code, Codex, or other agents out of the selection, even in the same folder.
  - **Cleanup timing:**
    - When the task ends, cleanup runs **after the CLI process has fully exited**, so a command still running at cancel time can't be spared as a live descendant.
    - Right before an Edit or Write is allowed in a task that ran a command, the CLI is waiting on that card. Task processes other than the CLI's live descendants are stopped then.
  - The user's own editors, terminals, and servers aren't sandboxed this way, so they are never touched.
  - A sandboxed job that moves elsewhere can still escape, but it keeps the inherited limits (workspace and task-temp writes, allowlisted reads, no network). This is documented as a known limit.
- **Card copy:**
  - The exact command is the main line.
  - Claude's description is shown smaller, labeled "Claude 설명".
  - The note reads: "작업 폴더에만 쓸 수 있고, 작업 폴더와 개발 도구 말고는 읽지 못하고, 인터넷은 쓸 수 없어. 명령이 바꾼 파일은 되돌리기로 복구되지 않아."

## Acceptance criteria

- **Unit tests:**
  - the settings, the environment allowlist, and the tool list for each case (edits off, unsupported platform, home workspace);
  - the Bash card, and approval with the original input;
  - `dangerouslyDisableSandbox`, `run_in_background`, an oversized command or timeout, and a `host` request are denied;
  - the inactivity timeout pauses during approval;
  - cleanup selection: only sandboxed processes started after the task, in the workspace or task temp, and not live descendants;
  - Codex's decline copy.
- **Real run with the installed Claude Code, in a temp workspace under the home folder.** With approval:
  - `npm test` (npm from nvm) runs and its result is reported;
  - `ls` produces a card;
  - `touch ~/…`, a `.git` write, `cat ~/.ssh/…`, `cat ~/.config/gh/hosts.yml`, and `ls /tmp/claude-<uid>` fail;
  - a network command gets no card and fails;
  - `env` shows no `GITHUB_TOKEN`-style variables;
  - a backgrounded `sleep` is gone after the task, while an editor started meanwhile in the workspace, and a sandboxed command from another agent there, are untouched;
  - cancelling during a long `npm test` leaves no process from it running;
  - `cat /Volumes/…` fails.
- CI passes.

## Explicitly deferred

- Commands on Codex, until it can run an approved command inside a sandbox.
- Allowing network per host.
- Undo for files that commands change.
- Long-running or background processes (dev servers).
