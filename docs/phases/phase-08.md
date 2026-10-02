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

- **Setting**
  - `editsEnabled` is stored per workspace under one canonical key: the folder's **real path** (`realpath`), the same value the task's `cwd` gets. A folder reached through a symlink (for example `/tmp` → `/private/tmp`) therefore matches.
  - Off is the default. Changing the workspace shows that folder's own setting.
- **Prompt**
  - Edits off: "Do not propose file changes."
  - Edits on: the current patch-tool text.
  - In both, shell commands are declined, as today.
- **Approval gate**
  - With edits off, the provider declines every `fileChange` request.
  - With edits on, the existing checks stay: inside the workspace, real paths, no `.git` and no repository-building names.
  - In edit mode Poko also declines **moves and renames** (`move_path`) and binary files. They can overwrite a destination that a checkpoint can't cover, and the diff can't show them.
  - The switch is **re-read when the user approves** (in `canStillApprove`). Turning editing off also declines every pending file-change approval, so a card shown earlier can't apply afterwards.
- **Checkpoint before approving**
  1. Right before main sends `accept`, it creates an `edits` row with status `pending` and a random id. It copies every touched file's current bytes into `userData/checkpoints/<edit id>/`, or records "absent" for an add. Only the random id is used as a folder name, never `taskId` or `requestId`.
  2. If any step fails, the change is declined.
  3. When Codex reports the item **completed**, Poko records the state after the change for each file: its SHA-256, or "absent" for a delete. The row becomes `applied`.
  4. If the item reports **failed**, or the task ends (cancelled, timed out, closed) before completion, the row becomes `failed`. Poko compares the files with the checkpoint: if anything changed anyway, the row becomes `applied` with the after-state it found. Only `applied` rows offer 되돌리기.
- **Undo** (`edits:undo`, trusted renderer only)
  1. For every file, the current state must equal the recorded after-state: same hash, or still absent for a delete. Otherwise the undo is refused with the file named, and the row stays `applied`, so the user can retry after resolving it.
  2. All-or-nothing restore:
     - first copy the current files to a temporary snapshot;
     - write each restored file to a temp file in the same folder and `rename` it into place (or delete it, for an add);
     - if any step fails, put the snapshot back and report the failure.
  3. Undo uses the same path checks. A successful undo sets the row to `undone` and is recorded in Activity.
- **Storage:** an `edits` table `{ id, taskId, requestId, conversationId, files (JSON: path, before: bytes-on-disk | absent, after: hash | absent), status: pending | applied | failed | undone | expired, createdAt }`. Checkpoints are removed when their conversation is deleted, or after 30 days, which sets the row to `expired` and hides 되돌리기.
- **Out of scope:** running tests or builds (shell commands stay declined), editing outside the selected workspace, moves and renames, and binary files.

## Milestone 1 notes (implemented)

- The composer's mode label is now a toggle, "읽기 전용" or "수정 허용". The folder button shows the same state. Turning edits on asks once; turning them off is immediate.
- The setting is stored per real path. The provider declines every file change while edits are off, and declines moves and binary diffs while they are on. Main re-reads the switch when the user approves a file change. Turning edits off also declines the pending file changes in that folder, and their cards disappear.
- The edits-on prompt tells Codex to propose changes with the patch tool even if earlier messages said the workspace was read-only. Without that line, a real run declined to propose a second change after an earlier "read-only" answer in the same conversation.
- The card shows each file relative to the workspace, labeled 새 파일, 수정, or 삭제, with `+n −m` counts and a colored diff. Three or fewer files open right away.
- Real run (Codex 0.159.3, a test git repository):
  - edits off: no change, with an explanation;
  - turned on: a card appeared, and approving changed `README.md`'s title;
  - a second change was proposed, and turning edits off while its card was pending declined it, leaving the file unchanged.

## Milestone 2 notes (implemented)

- `electron/edits/checkpoint.ts` handles the file work and is tested against a real temp folder:
  - updates, adds, and deletes restore exactly;
  - an undo is refused after a later change, including a file recreated after a delete;
  - a failure partway leaves every file as it was;
  - paths outside the folder and symbolic links are refused.
- `EditManager`:
  - takes a checkpoint right before main accepts an approved change; if that fails, the change is declined;
  - settles pending edits when the same task asks again or ends: `applied` with each file's after-state, or `failed` with the checkpoint removed;
  - undoes an edit and records it in Activity;
  - removes a deleted conversation's checkpoints, and expires edits after 30 days.
- Approval answers are serialized per request, so a double click can't checkpoint twice. Undo is refused while Poko works.
- The conversation shows a note per applied change, in time order, with 되돌리기. An undone note reads "되돌렸어", and an expired one says the undo window has passed.
- Real run (Codex 0.159.3, a test git repository):
  - approved a README change, then 되돌리기 restored `# Sample`;
  - approved a `greet.js` change, edited the file by hand, and 되돌리기 was refused with "‘greet.js’이(가) 그 뒤에 바뀌어서 되돌리지 않았어", keeping the hand edit.

## Milestones

1. **Edit switch and a better diff card:** the per-workspace setting and confirm, prompt and gate wiring, the colored diff with counts, and clear "수정 꺼짐" declines.
2. **Checkpoints and undo:** checkpoint before accept, the after-hash on completion, the `edits` table, the conversation note with 되돌리기, Activity entries, and cleanup.

## Acceptance criteria

- Edits off: no file can change; proposals are declined with the reason (unit test plus a real run).
- Edits on: an approved change applies exactly the shown diff; a declined one changes nothing (real run on a test repository).
- Undo restores the exact original bytes. It refuses when a file changed after the edit, including a file recreated after a delete. Adds and deletes are handled, and a failing restore leaves every file as it was (unit tests with a temp workspace and an injected write failure).
- A failed or interrupted change never shows 되돌리기 unless files actually changed.
- Turning editing off while a card is pending declines that change.
- A checkpoint failure declines the change.
- CI passes (typecheck, lint, format, tests, build), plus a GUI check of the card and undo in light and dark.
