# Phase 03 — Local persistence

## Goal

Persist the conversation, task history, Activity, workspace preference, and explicit memories across app restarts.

## Decisions

- Use Drizzle ORM with the built-in `node:sqlite` driver. Electron 44.4.5 bundles Node 24.21.0, and the driver avoids a native addon rebuild. Keep SQL operations short because `DatabaseSync` blocks the main process while each operation runs.
- Pin both `drizzle-orm` and `drizzle-kit` to `1.0.0-rc.4`: stable Drizzle `0.45.3` does not include the Node SQLite adapter. This gives the MVP its no-native-addon path, with a deliberate prerelease upgrade risk that should be revisited when Drizzle ships a stable adapter.
- Store `poko.sqlite` under `app.getPath("userData")`; never create a project database in the repository or selected workspace.
- Open and use SQLite only in Electron main. The renderer uses narrow typed IPC methods and receives serializable DTOs.
- Use a versioned SQL migration generated from the Drizzle schema. Apply migrations before registering handlers or creating the window; fail startup with a clear error if migration fails rather than silently running without persistence.
- Close the database after active workers have stopped during app shutdown. Use SQLite WAL for normal operation and allow SQLite to checkpoint it on close.
- On first launch after this migration, copy the workspace setting from the existing JSON file only when the database has no workspace value. Keep the JSON file intact.
- Persist a single default conversation and keep its messages separate from Tasks. Task start and user message insertion share one transaction.
- Persist normalized Activity events, task lifecycle, and assistant results. On next launch, mark tasks left running by an unclean exit as failed; do not attempt to resume a Codex subprocess.
- Memory is explicit user-managed CRUD with plain text search. No automatic extraction, embeddings, vector store, or credential storage.
- SQLite content is local and unencrypted in v0.1; rely on the operating-system user account's file protections. Do not store API keys or tokens in it.

## Initial schema

- `settings`: `key`, `value`, `updated_at`.
- `conversations`: `id`, `title`, `created_at`, `updated_at`.
- `messages`: `id`, `conversation_id`, `role`, `content`, `created_at`.
- `tasks`: `id`, `title`, `prompt`, `provider`, `status`, `workspace`, `created_at`, `completed_at`.
- `activities`: `id`, `task_id`, `type`, `message`, `created_at`.
- `memories`: `id`, `type`, `content`, `importance`, `source`, `created_at`, `updated_at`.

Use UUID text ids, ISO UTC timestamps, foreign keys, and indexes for chronological and status queries. Add a task state `cancelled` to the runtime/storage model. Search strings are parameterized and wildcard characters are escaped so the API behaves as literal substring search.

## IPC and UX

- Add a bootstrap method for workspace, conversation messages, tasks, and Activity; add memory list/search/save/delete methods. Keep provider execution and database handles private to main.
- Restore messages/tasks/activities when the renderer starts. Preserve the current character-led layout; Tasks and Activity views become history lists, while Memory receives a small explicit add/search/delete interface.
- Show friendly persistence errors without exposing SQL or filesystem internals.

## Verification

- Test migrations, foreign keys, transactional task/message creation, literal memory search, memory CRUD, and workspace JSON import using temporary file-backed databases.
- Close and reopen the database in tests to verify persistence and stale-running-task recovery.
- Run typecheck, lint, tests, format check, and production build.
- If GUI support is available, restart the desktop app and verify messages, tasks, workspace, and memory survive.

## Implementation status

Implemented on the Phase 03 branch: six-table Drizzle schema and generated SQLite migration; startup migration and stale-task recovery; SQLite-backed workspace setting with one-time legacy JSON import; atomic user-message/task creation; persistent task events, Activity, assistant results, and explicit memory CRUD/search; bootstrap restoration in the renderer; and a small Memory view. File-backed database tests cover migration/reopen, task recovery, workspace import, persistence, and literal substring search.

The Node runtime currently reports `node:sqlite` as experimental in the development test environment. The adapter is built into the supported Electron Node runtime and avoids a native package, but the API maturity and Drizzle RC pin remain explicit MVP risks.
