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

## What the user experiences

- With **수정 허용** on and **Claude Code** as the engine, Poko can propose a command. A command card shows:
  - the exact command, the folder, and Claude's one-line description;
  - the note "작업 폴더에만 쓸 수 있고, 문서·키·설정 같은 개인 파일은 읽지 못하고, 인터넷은 쓸 수 없어. 명령이 바꾼 파일은 되돌리기로 복구되지 않아."
  - Approve runs it once; decline tells Claude not to.
- After it runs, Activity shows the command and its exit result. The output itself stays with Claude.
- **Read-only mode:** commands are never offered.
- **Codex:** command requests are declined with "Codex에서는 명령 실행을 아직 안전하게 할 수 없어. 설정에서 엔진을 Claude Code로 바꾸면 승인 후 샌드박스 안에서 실행할 수 있어."
- The 수정 허용 tooltip and the edits confirmation say that, on Claude Code, it also allows proposing commands.

## Design

- **Where it runs:**
  - Commands are offered only on macOS with Claude Code 2.1.287 or newer, the version these probes verified.
  - Anywhere else, the sandbox isn't verified, so Bash isn't offered. With edits on, Activity explains it once at the task's start: "이 환경에서는 명령 실행을 지원하지 않아." The 수정 허용 tooltip says commands need Claude Code on macOS.
- **Settings passed with `--settings`** (every settings file stays out with `--setting-sources ""`):
  - `permissions.ask: ["Bash"]`, so no command runs without a card;
  - `sandbox.enabled: true`, `autoAllowBashIfSandboxed: false`, `allowUnsandboxedCommands: false`;
  - `sandbox.filesystem.denyRead`: a fixed list of private places in the home folder, and `allowRead: [workspace]` so a workspace inside one of them still works. Denying the whole home folder broke npm, npx, and pnpm from nvm, fnm, volta, and asdf, and their caches.
    - Documents, Desktop, Downloads, Pictures, Movies, Music
    - `~/Library` (Keychains, Mail, Messages, browser data, Application Support)
    - `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.azure`, `~/.config/gcloud`, `~/.kube`, `~/.docker`
    - `~/.netrc`, `~/.git-credentials`, `~/.npmrc`, `~/.pypirc`
    - shell histories
    - `~/.claude`, `~/.codex`
  - `sandbox.network.allowUnixSockets: []` and `allowLocalBinding: false`.
- **Environment:**
  - The CLI keeps the environment it needs: sign-in (`ANTHROPIC_*`, `CLAUDE_*`), providers (`AWS_*`, `GOOGLE_*`, `VERTEX_*`, `CLOUD_ML_*`), and proxy and certificate variables.
  - Other variables whose names contain `TOKEN`, `SECRET`, `PASSWORD`, `PASSWD`, `CREDENTIAL`, `API_KEY`, or `PRIVATE` are removed, so tokens such as `GITHUB_TOKEN` or `NPM_TOKEN` aren't handed to commands.
  - What is kept for Claude Code remains visible to an approved `env`. This is documented.
- **Temp files:** nothing extra is needed. Claude Code gives commands a sandbox-writable `TMPDIR`.
- **Tools:** when edits are on, `ClaudeCodeProvider` adds `Bash` to `--tools`. It passes the sandbox settings above with `--settings`; `--setting-sources ""` still keeps every settings file out.
- **Init check:** the init check allows `Bash` only in that case.
- **Permission policy** for Bash:
  - The input must carry a non-empty `command` (at most 2,000 characters).
  - It must not set `dangerouslyDisableSandbox`; a request that does is denied.
  - `run_in_background` is denied, because a background process would outlive the card.
  - A `timeout` above 5 minutes is **denied, not clamped**, so the allowed input is always the original. Claude Code's own default is 2 minutes.
  - The task timeout becomes an **inactivity** timeout: 10 minutes without any event from the CLI, paused while a card waits for the user. A fix, test, fix loop isn't cut off as long as it keeps making progress.
  - The card is `kind: "command"` with `canApprove: true`. Approve sends `allow` with the original input.
- **Network:**
  - A permission request with a `host` (network access) is always denied, with no card and an Activity note.
  - A network request is never offered for approval.
- **Same rules as file changes:** one-shot answers, the 5-minute approval timeout, and decline on cancel or task end. A command card has no file checkpoint.
- **`canStillApprove`** for a command re-runs the same input checks: command length, no `dangerouslyDisableSandbox`, no background run, and the timeout limit. It never consults `planEdit`.
- **Leftover processes:**
  - Groups and parents don't reach orphaned jobs, so Poko looks them up by where they run instead.
  - When the task ends, and right before it allows an Edit or Write in a task that ran a command, Poko lists the user's processes with their working folder and start time (`lsof -a -d cwd` / `ps`).
  - It stops those that run inside the workspace, started after the task began, and are not Poko, the CLI, or a live descendant of the CLI (its own helpers, such as ripgrep).
  - The user's own servers, started before the task, are never touched.
  - A job that changes folder out of the workspace can still escape. It stays inside the inherited sandbox (workspace writes only, private folders unreadable, no network). This is documented as a known limit.
- **Card copy:**
  - The exact command is the main line.
  - Claude's description is shown smaller, labeled "Claude 설명", because it is the model's claim, not a check.
- **Codex:** the existing command decline gets the new explanation.
- **Prompt:** with edits on and Claude Code as the engine, the safety line says commands may be proposed. They need approval, run sandboxed without network, and their file changes can't be undone. Edits to files should still go through Edit or Write.

## Acceptance criteria

- Unit tests:
  - the args include `Bash` and the sandbox settings only when edits are on;
  - a Bash request becomes a command card, and approval allows it with the original input;
  - `dangerouslyDisableSandbox`, `run_in_background`, an empty or oversized command, and a `host` request are denied;
  - Codex's decline copy.
- Real run with the installed Claude Code, in a temp workspace:
  - "테스트 돌려 줘" gets a card, and after approval the test runs and the answer reports it;
  - an approved `touch ~/…` or a `.git` write fails;
  - an approved `cat ~/.ssh/…` fails;
  - `npm test` with nvm's npm works;
  - `ls` still produces a card;
  - a network command gets no card and fails;
  - a backgrounded `sleep` is gone after the task.
- CI passes.

## Explicitly deferred

- Commands on Codex, until it can run an approved command inside a sandbox.
- Allowing network per host.
- Undo for files that commands change.
- Long-running or background processes (dev servers).
