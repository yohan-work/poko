# Phase 02 — Read-only Codex worker

## Goal

Let Poko inspect a selected project through the locally installed Codex CLI and show concise progress and a final response in the character conversation.

## Included

- A provider contract and a small Agent Core that owns task ids, process cancellation, and normalized events.
- A Codex provider that starts `codex exec --json` with the selected workspace as its working directory.
- Incremental JSONL parsing with tolerant handling of unknown event types and clear errors for malformed output.
- Read-only Codex sandboxing. This phase supports project inspection and analysis; it does not permit the worker to edit project files.
- Narrow Electron IPC for task start, cancellation, and task event subscription. The renderer cannot choose a cwd or invoke arbitrary commands.
- Canonicalize and verify the saved workspace directory in the main process before execution.
- In-memory progress/activity display, timeout, cancellation, and friendly missing-CLI/auth/process errors.
- A coding skill with concise project-editing guidance for future write-enabled phases.

## Excluded

- File modification, dependency installation, deletion, git mutations, deployment, or other external side effects.
- SQLite, durable task history, persistent conversation history, and memory extraction (Phase 03).
- In-app command-level approval and write permission (Phase 04).
- Claude, browser, scheduler, and routines.

## Permission policy

- Use `--sandbox read-only` and `--ask-for-approval on-request`; do not enable network access or additional writable directories.
- Treat a selected workspace as a read boundary, not as permission to modify it.
- If Codex requests a permission this app cannot grant, fail closed and explain that the action is not available yet.
- Never use approval-bypass or sandbox-bypass CLI options.

## Verification

- Unit-test event mapping for representative Codex JSONL records, unknown event types, malformed lines, process errors, timeout, and cancellation.
- Test Agent Core event forwarding and one-active-task behavior with a fake provider.
- Test workspace validation against missing paths and non-directories.
- Run typecheck, lint, tests, format check, and production build.
- Do not invoke a real Codex task during automated tests; that could send the selected project's context to a model service and consume the user's account.
- Manually launch the app and verify a read-only project analysis when a GUI and authenticated Codex CLI are available.

## Acceptance scenario

1. Choose a project folder.
2. Ask Poko to analyze the project structure and suggest improvements.
3. Poko reports that it is inspecting the project, shows normalized activity, and returns Codex's final answer.
4. No project file is modified. Tasks and activity remain in memory until Phase 03.
