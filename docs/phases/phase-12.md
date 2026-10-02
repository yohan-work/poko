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

## What the user experiences

- With **수정 허용** on and **Claude Code** as the engine, Poko can propose a command. A command card shows:
  - the exact command, the folder, and Claude's one-line description;
  - the note "작업 폴더 안에서만 읽고 쓰고, 인터넷은 쓸 수 없어. 명령이 바꾼 파일은 되돌리기로 복구되지 않아."
  - Approve runs it once; decline tells Claude not to.
- After it runs, Activity shows the command and its exit result. The output itself stays with Claude.
- **Read-only mode:** commands are never offered.
- **Codex:** command requests are declined with "Codex에서는 명령 실행을 아직 안전하게 할 수 없어. 설정에서 엔진을 Claude Code로 바꾸면 승인 후 샌드박스 안에서 실행할 수 있어."
- The 수정 허용 tooltip and the edits confirmation say that, on Claude Code, it also allows proposing commands.

## Design

- **Where it runs:**
  - Commands are offered only on macOS with Claude Code 2.1.287 or newer, the version these probes verified.
  - Anywhere else, the sandbox isn't verified, so Bash isn't offered and the card explains why.
- **Settings passed with `--settings`** (every settings file stays out with `--setting-sources ""`):
  - `permissions.ask: ["Bash"]`, so no command runs without a card;
  - `sandbox.enabled: true`, `autoAllowBashIfSandboxed: false`, `allowUnsandboxedCommands: false`;
  - `sandbox.filesystem.denyRead: [home]` and `allowRead: [workspace, the folder that holds the found node]`, so a command can't read the user's files, keys, or shell history;
  - `sandbox.network.allowUnixSockets: []` and `allowLocalBinding: false`.
- **Environment:** the CLI starts with a minimal environment (`PATH`, `HOME`, `USER`, `LANG`, `TMPDIR`, `SHELL`), so tokens in the app's environment aren't passed on.
- **Tools:** when edits are on, `ClaudeCodeProvider` adds `Bash` to `--tools`. It passes the sandbox settings above with `--settings`; `--setting-sources ""` still keeps every settings file out.
- **Init check:** the init check allows `Bash` only in that case.
- **Permission policy** for Bash:
  - The input must carry a non-empty `command` (at most 2,000 characters).
  - It must not set `dangerouslyDisableSandbox`; a request that does is denied.
  - `run_in_background` is denied, because a background process would outlive the card.
  - A `timeout` above 5 minutes is **denied, not clamped**, so the allowed input is always the original. Claude Code's own default is 2 minutes. The task timeout grows to 20 minutes for tasks that may run commands, so a 5-minute command after a 5-minute approval wait still fits.
  - The card is `kind: "command"` with `canApprove: true`. Approve sends `allow` with the original input.
- **Network:**
  - A permission request with a `host` (network access) is always denied, with no card and an Activity note.
  - A network request is never offered for approval.
- **Same rules as file changes:** one-shot answers, the 5-minute approval timeout, and decline on cancel or task end. A command card has no file checkpoint.
- **`canStillApprove`** for a command re-runs the same input checks: command length, no `dangerouslyDisableSandbox`, no background run, and the timeout limit. It never consults `planEdit`.
- **Leftover processes:**
  - After each Bash result, and when the task ends, Poko lists the CLI's descendant processes (`ps -axo pid=,ppid=`) and stops them.
  - A process that fully detaches can escape that list. It stays inside the inherited sandbox (workspace writes only, no reads of the home folder, no network), and this is documented as a known limit.
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
  - an approved `cat ~/…` fails;
  - `ls` still produces a card;
  - a network command gets no card and fails;
  - a backgrounded `sleep` is gone after the task.
- CI passes.

## Explicitly deferred

- Commands on Codex, until it can run an approved command inside a sandbox.
- Allowing network per host.
- Undo for files that commands change.
- Long-running or background processes (dev servers).
