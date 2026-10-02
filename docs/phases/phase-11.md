# Phase 11 — Claude Code as an engine

## Goal

Let people who use Claude Code instead of Codex use Poko with their own installed `claude` CLI and their own sign-in. Poko never handles an API key or a token. The character, the conversations, approvals, edit checkpoints, and undo work the same with either engine.

## Today

- Every task runs through `CodexAppServerProvider`, behind the `AgentProvider` contract in `electron/agent/AgentProvider.ts`.
- The setup screen and 설정 check only Codex.
- Screen tasks (화면 보기, 대신 해 줘) ask Codex through `ctx.screenProvider`.

## What we learned from the CLI (Claude Code 2.1.x)

The probe ran in a temp folder.

- **Starting a task:**
  - `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages` reads user messages as JSON lines on stdin and writes JSON lines to stdout.
  - Those lines are `system/init`, `stream_event` (text and tool deltas), `assistant`, `user` (tool results), and `result`.
- **Permission prompts:**
  - With `--permission-prompt-tool stdio`, a tool that needs permission sends `control_request` `{ subtype: "can_use_tool", tool_name, input, tool_use_id }`.
  - For `Edit`, the input carries `file_path`, `old_string`, and `new_string`.
  - The host answers with `control_response` `{ behavior: "allow", updatedInput }` or `{ behavior: "deny", message }`.
  - An `initialize` control request is sent first.
- **Without a host answering:**
  - `--permission-prompts host` without `--permission-prompt-tool stdio` silently denies.
  - So Poko must always pass `stdio`.
- **Tools:** `--tools Read,Grep,Glob` limits the built-in tools, plus `Edit,Write` when edits are on.
- **Isolation:**
  - `--safe-mode` disables the user's hooks, skills, plugins, MCP servers, and CLAUDE.md, so none of them run inside Poko.
  - `--no-session-persistence` leaves no session files.
- **Settings files:**
  - The CLI applies permission rules from settings files **before** it asks the host.
  - A user's or a cloned project's `.claude/settings.json` with `defaultMode: "acceptEdits"` / `"bypassPermissions"`, an `allow` rule for Edit or Write, or `additionalDirectories` could write or read without a card.
  - So Poko passes `--setting-sources ""`, which loads no user, project, or local settings, together with an explicit `--permission-mode default`.
  - Organization-managed settings still apply, and that is intended.
- **Sign-in:** `claude auth status --json` reports `loggedIn` and `authMethod` without starting a model request.

## What the user experiences

1. **설정 → 엔진:** choose **Codex** or **Claude Code**.
   - The choice applies to the next message.
   - Each option shows whether that CLI is installed and signed in.
2. **Setup screen:** if the chosen engine isn't ready, the setup screen explains what is missing for that engine, using the same steps:
   - install: `npm install -g @anthropic-ai/claude-code` or the native installer;
   - sign in: `claude` in a terminal, then `/login`;
   - version.
3. **Conversations and edits:** these behave as they do today.
   - Read-only by default. With edits allowed, Claude's `Edit` / `Write` calls become the same file-change approval cards with a diff.
   - Approving checkpoints the files first, and undo works.
   - Any other permission request is declined automatically: reading outside the workspace, shell, network, and so on.
4. **화면 보기 and 대신 해 줘:**
   - These stay on Codex in this phase.
   - With Claude Code chosen and Codex not ready, the picker says that screen features need Codex.

## Design

- **`ClaudeCodeProvider`** (`electron/providers/claude/`) implements `AgentProvider`.
  - It spawns one process per task in the workspace with the flags above: `--safe-mode`, `--setting-sources ""`, `--permission-mode default`, `--strict-mcp-config`, and `--no-session-persistence`.
  - The `system/init` line reports the effective `permissionMode` and tools. If the mode isn't `default`, or a tool outside the allowed list appears, the task stops with an error before any prompt is sent.
  - It sends `initialize` and then the prompt Agent Core built, so memories, history, and the skill are included.
- **Event mapping** into the existing `AgentEvent`. No raw CLI output reaches the renderer.
  - Text deltas become `output`, with `itemId` set to the message id.
  - `tool_use` starts become `tool`, with a short detail such as a relative path or pattern.
  - Thinking becomes `thinking`.
  - `result` success becomes `completed` with the final text.
  - `result` error, a non-zero exit, or broken JSON becomes `error` with plain Korean copy.
  - Cancelling sends an `interrupt` control request, kills the process after a short grace period, and ends with `cancelled`.
- **Permission policy** (the main-process provider decides; the model can't widen it):
  - `Edit` or `Write` on a path that resolves inside the workspace, when edits are on, becomes `approvalRequired` with `kind: "file_change"` and a diff.
    - It must also pass the same checks as Codex changes: never under `.git` (`touchesGitDirectory`), and never creating or extending a repository (`buildsRepository`, exported for reuse). The checks run on real paths, and again in `canStillApprove`.
    - The diff is computed by Poko, not taken from the model.
      - For Edit, Poko reads the file and applies `old_string` → `new_string`, every match when `replace_all` is set. It refuses if `old_string` doesn't match exactly once and `replace_all` is off. It then shows a unified diff of the whole result.
      - For Write, the diff runs against the current file, or is all-new content for a new file.
      - `canStillApprove` recomputes this and refuses if the file changed since the card was shown.
    - Binary content and files over a size limit are refused.
    - `fileChangePaths` returns that one path.
    - Approval flows through the existing checkpoint path in `electron/app/tasks.ts`.
  - Everything else is denied immediately, with a message telling the model it isn't allowed.
  - Symlinks and `..` are resolved with `realpath` against the workspace, as the Codex path already does.
- **Engine setting:**
  - `settings.engine` is `"codex"` (the default) or `"claude"`.
  - `EngineProvider` (`electron/agent/`) picks the provider when each task starts and routes that task's approvals back to it, so a change applies to the next task and can't affect one in flight.
  - The 설정 control is disabled while a task runs.
- **Status:** milestones 1 and 2 are done.
- **Setup:**
  - `SetupService` gains a Claude check: find `claude` in the same known places (`~/.local/bin`, Homebrew, npm global, nvm), then run `claude --version` and `claude auth status --json`.
  - `CodexSetup` generalizes to an `EngineSetup` with an `engine` field. The renderer's setup steps use engine-specific copy.
  - Login isn't started from Poko for Claude Code. The screen shows the terminal command instead, because `/login` is interactive.

## Milestones

1. **Engine choice and read-only Claude Code**
   - The setting, the setup check, the provider with event mapping, and cancel.
   - Every permission request is denied.
2. **Edits through approvals**
   - `can_use_tool` for Edit and Write inside the workspace becomes file-change cards, with the checkpoint before allow and undo.
   - Screen features explain that they need Codex when Claude Code is chosen.

## Acceptance criteria

- Unit tests with a fake `claude` process:
  - the event mapping (text, tools, result, error, broken JSON, exit);
  - the permission policy:
    - an edit inside is offered as a card;
    - outside, a symlink escape, `.git`, or repository files are denied;
    - shell is denied;
    - everything is denied when edits are off;
    - the `replace_all` diff shows every match;
  - the args always include `--setting-sources ""` and `--permission-mode default`, and an init reporting another mode stops the task;
  - cancel.
- Real run with the installed CLI in a temp workspace:
  - a read-only question gets an answer;
  - with edits on, an edit becomes a card; approving writes the file and undo restores it; declining leaves it unchanged.
  - Hooks and skills from `~/.claude` don't run (`--safe-mode`).
  - A workspace whose `.claude/settings.json` sets `defaultMode: "acceptEdits"` and allows `Edit` still produces a card, and the file isn't changed before approval.
- The setup screen shows the right steps when `claude` is missing or signed out (unit test for the steps).
- Codex users see no change. All existing tests pass, and CI passes.

## Explicitly deferred

- Screen tasks on Claude Code (it can take images, but the screen loop is tuned for Codex).
- Shell commands with approval on either engine.

## Follow-up: choosing a model

- A select under the message box, next to 읽기 전용 / 수정 허용, picks the model for the current engine.
  - It applies from the next message and is disabled while a task runs.
  - The choice is stored per engine (`codexModel`, `claudeModel`), and **기본값** leaves the choice to the CLI.
- **Codex:**
  - The list comes from the App Server's `model/list`, so it shows only the models the account can use, without hidden ones.
  - It is fetched from a temp folder with no MCP servers and cached for 10 minutes.
  - `thread/start` gets the model.
- **Claude Code:**
  - The list is the aliases `fable`, `opus`, `sonnet`, and `haiku`, each the latest of its kind, passed as `--model`.
- **Validation:** model names are checked (`isModelName`) before they are saved or passed to a CLI.
- **Errors:** a model the account can't use ends with "이 모델은 지금 계정에서 쓸 수 없어. 입력창 아래에서 모델을 기본값으로 바꿔 줘."
- **Screen tasks** always use Codex's default model.
