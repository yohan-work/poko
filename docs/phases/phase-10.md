# Phase 10 — Settings and your data

## Goal

Give the user one place to see and control what Poko keeps and sends: whether memories are used, how long undo data is kept, the screen permissions and notice, and the Codex setup. Also let them take all their data out, or remove it, without digging through folders.

## Today

- Saved memories always go into every prompt (Phase 05). There is no switch.
- Undo checkpoints are kept 30 days, fixed in code.
- The screen notice is accepted once and can't be shown again. Permissions are only visible inside the window picker.
- The Codex setup screen appears only when something is wrong.
- Conversations, tasks, Activity, approvals, memories, and edits live in SQLite under the app's data folder. There is no export or delete-all.

## What the user experiences

A **설정** page in the sidebar, after 활동, with sections:

1. **Codex:** version, path, and sign-in, with 다시 확인, which opens the setup screen when something is missing.
2. **기억:** "대화에 기억 사용" (on by default). When it is off, saved memories stay in the 기억 page but are not sent with requests.
3. **화면 보기:**
   - the Screen Recording and Accessibility status, with 설정 열기;
   - "안내 다시 보기", which shows the data-use notice again before the next screen task.
4. **수정과 되돌리기:** how long undo data is kept, chosen from 7, 30 (default), or 90 days. A shorter period applies at the next start, and older checkpoints are removed then.
5. **데이터:**
   - **모두 내보내기:** a JSON file through the system save dialog, holding conversations with messages, tasks with results, Activity, approvals, memories, and edit records (file names only, not checkpoint contents);
   - **데이터 폴더 열기:** opens the folder in Finder;
   - **모든 데이터 삭제:** after an in-app confirmation where the user types "삭제", it removes conversations, messages, tasks, Activity, approvals, memories, edits, and checkpoints. The app starts fresh with the greeting screen. The workspace, edit switches, and the screen notice are kept, because they are settings, not history.
6. **정보:** the app version and the project address, as text. The window opens no links.

## Design

- **Settings storage:** the existing `settings` table with keys `memoriesInContext` (`"false"` when off) and `checkpointDays` (`7`, `30`, or `90`). A typed `getSettings` / `setSettings` in `Database` validates each value and ignores anything invalid.
- **Status:** milestones 1 and 2 are done. The page refreshes permissions when the window regains focus, so changes made in System Settings show up on return.
- **Memories in context:** `getTaskContext` returns no memories when the setting is off. Recent exchanges are unchanged.
- **Retention:** `EditManager.expireOld` takes the days from the setting at startup.
- **Notice reset:** delete `screenNoticeAccepted`.
- **Export** (`data:export`, trusted renderer only)
  - Main builds the JSON (`{ version: 1, exportedAt, conversations, tasks, activities, approvals, memories, edits }`) and asks for a path with `dialog.showSaveDialog`, defaulting to `poko-export-YYYY-MM-DD.json` in Downloads. It writes to a temporary file with mode `0600` in the same folder and renames it into place, so overwriting an existing file can't keep that file's looser permissions.
  - The renderer never sees the path picker's result beyond "saved" or "cancelled".
- **Delete all** (`data:delete-all`, trusted renderer only)
  - Refused while a task runs **or is starting**. A start in progress (for example while 화면 보기 captures the window into the temp folder) is counted by a new main-process counter around every task-starting handler. The existing per-conversation count misses starts without a conversation.
  - Deletes all history rows in one transaction, and removes the checkpoints folder and the screen temp folder.
  - It **returns** fresh bootstrap data, since main has no channel to push it. The renderer then resets every cached slice to it: messages, conversations, the active conversation, tasks, Activity, memories, edit notes, pending approvals, and streaming. No deleted item stays visible on any page.
  - The confirmation word is checked in the renderer **and** sent to main, which refuses without it.
- **Open data folder** (`data:open-folder`): `shell.openPath(userData)`.

## Milestones

1. **Settings page:** the Codex section, the memories switch (with the `getTaskContext` change), screen permissions and notice reset, the retention choice, and info.
2. **Your data:** export, open folder, and delete-all with confirmation.

## Acceptance criteria

- With memories off, the prompt context holds no memories (unit test), and the 기억 page still lists them.
- Retention: with 7 days chosen, an edit 8 days old is expired at the next start (unit test).
- Export writes valid JSON with every listed section. Its counts match the database (unit test plus a real run).
- Delete-all is refused while a task runs, while one is starting, and without the confirmation word. After it runs, the tables are empty, the checkpoints and temp folders are gone, every page (대화, 작업, 기억, 활동) shows the empty state, and the app shows the greeting screen (unit test plus a real run). Settings are kept.
- An export that overwrites an existing file leaves it with `0600` permissions.
- CI passes, plus a GUI check of the page in light and dark.

## Explicitly deferred

- Importing an export.
- Encrypting the database.
- Per-conversation memory switches.
