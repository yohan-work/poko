# Phase 08 — Approved edits with undo

## Goal

Let Poko change files in the selected project, safely enough to trust: the user turns editing on for a workspace, sees every change as a diff before it happens, approves each one, can undo it afterwards, and can always see what changed.

## What we checked first

Codex already proposes edits as approval requests, even in the read-only sandbox. A real run (Codex 0.159.3, a test git repository) asked "README.md의 제목을 '# Poko Sample'로 바꿔 줘." and got:

- a `file_change` approval with the diff;
- on decline, no file changed.

Phase 04 verified that approving applies exactly that change.

So the safest design keeps Codex in the read-only sandbox and adds safety around the existing approval path, instead of widening the sandbox.

- **Rejected: running Codex with `workspace-write`.** Codex could then write files and run commands inside the workspace **without asking**. Approval policies (`untrusted`, `on-request`, granular) don't make every file write ask. That would break "every change is approved".
- **Rejected: Poko applying its own patches from Codex's text answer.** It is more code that duplicates what Codex's patch tool and Phase 04's checks already do.

## What the user experiences

- **Editing is off by default.**
  - The workspace button and composer show "읽기 전용" or "수정 허용".
  - Turning it on is per workspace and stored. It asks once, with a short explanation: Poko will propose changes, each needs approval, and each can be undone.
- **With editing on:** the user asks for a change, and the card shows the files and a readable diff (added and removed lines colored, plus `+n −m` counts per file). 이번 한 번만 허용 applies exactly that diff.
- **With editing off:** a proposed change is declined automatically with a plain reason ("수정이 꺼져 있어. 폴더 메뉴에서 수정을 허용하면 변경을 제안할 수 있어."). The prompt also tells Codex not to propose edits.
- **After a change is applied,** the conversation shows a small "변경했어" note with the files, and a **되돌리기** button. Undo restores the files exactly as they were before that change. It refuses, saying why, if a file has changed since; it never overwrites newer work.
- Activity lists every applied and undone change with its files.

## Design

- **Setting:** `editsEnabled` per workspace path (settings table). Off is the default, and changing the workspace shows that folder's own setting.
- **Prompt:**
  - Edits off: "Do not propose file changes."
  - Edits on: the current patch-tool text.
  - In both, shell commands are declined, as today.
- **Approval gate:**
  - With edits off, the provider declines every `fileChange` request.
  - With edits on, the existing checks stay: inside the workspace, real paths, no `.git` and no repository-building names, re-validated when approving.
- **Checkpoint before approving.** Right before main sends `accept` for a file change, it copies the current contents of every file in the change to `userData/checkpoints/<taskId>/<requestId>/`, or records that the file did not exist (for an add). It also records each file's SHA-256 after the change once Codex reports the item completed. If the checkpoint can't be written, the change is declined.
- **Undo** (`edits:undo`, trusted renderer only):
  1. For each file, compare the current SHA-256 with the recorded "after" hash; any mismatch refuses the undo.
  2. Then restore the originals (delete added files, recreate deleted ones), all-or-nothing within the workspace and with the same path checks.
  3. Undo itself is recorded in Activity.
- **Storage:** an `edits` table `{ id, taskId, requestId, conversationId, files (JSON: path, before?, afterHash), status: applied | undone | undo_refused, createdAt }`. Checkpoint contents stay on disk, removed when the conversation is deleted or after 30 days.
- **Out of scope:** running tests or builds (shell commands stay declined), editing outside the selected workspace, and binary files (proposals touching them are declined).

## Milestones

1. **Edit switch and a better diff card:** the per-workspace setting and confirm, prompt and gate wiring, the colored diff with counts, and clear "수정 꺼짐" declines.
2. **Checkpoints and undo:** checkpoint before accept, the after-hash on completion, the `edits` table, the conversation note with 되돌리기, Activity entries, and cleanup.

## Acceptance criteria

- Edits off: no file can change; proposals are declined with the reason (unit test plus a real run).
- Edits on: an approved change applies exactly the shown diff; a declined one changes nothing (real run on a test repository).
- Undo restores the exact original bytes; it refuses when a file changed after the edit; add and delete are handled (unit tests with a temp workspace).
- A checkpoint failure declines the change.
- CI passes (typecheck, lint, format, tests, build), plus a GUI check of the card and undo in light and dark.
