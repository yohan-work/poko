# Poko architecture

Poko is a local-first desktop character that accepts a user's request, decides whether work should run, delegates that work to an agent provider, and presents a concise result. The first release is an Electron application with a character-led conversation UI. Work runs on Codex or Claude Code, read-only by default, with approved edits and (on Claude Code) sandboxed commands.

## Scope and implementation shape

Start as one pnpm application rather than a multi-package workspace. Keep clear module boundaries in the source tree and extract packages only when multiple consumers or independent releases require them.

```text
.
├── electron/
│   ├── main.ts              # lifecycle: services, window, quit
│   ├── app/                 # IPC handlers by area, sharing `ctx` (context.ts)
│   │   ├── context.ts       # main-process state and shared helpers (trust check, task start)
│   │   ├── events.ts        # task events → database, Activity, renderer
│   │   ├── tasks.ts         # tasks, approvals (with edit checkpoints), conversations
│   │   ├── screen.ts        # 화면 보기 and 대신 해 줘
│   │   ├── data.ts          # export, data folder, delete all
│   │   ├── quick.ts         # quick panel channels and its global shortcut
│   │   ├── edits.ts         # edit switch, approved changes, undo
│   │   ├── settings.ts      # 설정 preferences and app version
│   │   ├── setup.ts         # Codex and Claude Code setup check and sign-in
│   │   ├── routines.ts      # 루틴 page channels and starting a routine's run
│   │   ├── notify.ts        # task notifications
│   │   ├── dictation.ts     # starting macOS Dictation in Poko's own window
│   │   └── workspace.ts     # workspace, app data, memories
│   ├── preload.ts           # narrow, typed renderer bridge
│   ├── eventGuards.ts       # shape checks for task events sent to the renderer
│   ├── settings.ts          # legacy workspace settings import helpers
│   ├── shared.ts            # IPC channels and domain types
│   ├── database/            # SQLite connection, schema, and persistence
│   ├── agent/               # Agent Core, provider contract, engine routing
│   ├── attachments/         # checks and temp files for dropped files and images
│   ├── export/              # private (0600) file writes for export
│   ├── quick/               # the quick panel window and its reduced task view
│   ├── edits/               # checkpoints and undo for approved changes
│   ├── screen/              # window capture, accessibility helper, overlay, step loop
│   ├── setup/               # Codex and Claude Code setup checks
│   ├── routines/            # routine schedule and the timer that runs them
│   ├── notify/              # the one-line text of a task notification
│   ├── providers/codex/     # Codex App Server adapter and environment
│   └── providers/claude/    # Claude Code (stream-json) adapter, edit planning, sandboxed commands
├── src/renderer/
│   ├── index.html
│   └── src/
│       ├── components/
│       │   ├── character/   # character states
│       │   ├── chat/        # conversation UI
│       │   └── activity/    # task, Activity, and Memory views
│       └── state/           # renderer state (Zustand)
├── skills/coding/SKILL.md
├── docs/
└── package.json
```

## Process boundaries

### Electron main

- Own the application lifecycle and create the `BrowserWindow`.
- Enable `contextIsolation`; disable renderer Node integration. Keep the preload sandboxed where supported.
- Own native dialogs, persisted desktop settings, task execution, and future SQLite access.
- Run future providers as child processes from this trusted process. Pass arguments as an argv array, never by interpolating a shell command.

### Preload

- Expose a small `window.poko` API through `contextBridge`.
- Validate IPC payload shapes and keep channel names internal to the bridge.
- Expose only operations the UI needs. Do not expose raw `ipcRenderer`, `fs`, `child_process`, or a generic shell API.

### Renderer

- Render the character, conversation, workspace state, and user-visible task progress.
- Use Zustand for UI state. It cannot access Node APIs or execute tools.
- Display normalized Poko messages and `AgentEvent` values, not unfiltered provider output.

## IPC contract

Requests use a typed request/response API; long-running task updates use a typed event subscription. Each payload carries only the information needed for its operation.

| Operation | Direction | Phase | Contract |
| --- | --- | --- | --- |
| `workspace.get` | renderer → main | 01 | Returns `{ path, name }` or `null` |
| `workspace.select` | renderer → main | 01 | Opens a native directory picker; returns `{ path, name }` or `null` |
| `task.start` | renderer → main | 02 | Accepts a message string; main resolves the saved workspace and returns `{ taskId: string }` |
| `task.cancel` | renderer → main | 02 | Accepts a task id owned by the current renderer and requests process cancellation |
| `task.event` | main → renderer | 02 | Streams a validated `{ taskId, event: AgentEvent }` |
| `app.bootstrap` | renderer → main | 03 | Returns workspace, default conversation messages, tasks, and Activity |
| `memory.list/search/save/delete` | renderer → main | 03 | Explicit local memory CRUD and literal text search |

Cancellation and approval responses are explicit operations: `task:cancel` takes a task id, and `approval:respond` takes only `{taskId, requestId, choice}`. Do not create a generic IPC escape hatch.

## Agent Core and provider contracts

The Agent Core is the only layer that converts a user request into a task and selects a provider. Phase 01 used a mock response; Phase 02 sends analysis tasks to Codex through a restricted read-only permission profile.

```typescript
interface AgentTask {
  id: string;
  prompt: string;
  cwd: string;
  mode?: "read" | "write";
}

interface AgentProvider {
  runTask(input: AgentTask, options?: { signal?: AbortSignal }): AsyncIterable<AgentEvent>;
}
```

`Task` persists the work lifecycle independently from `Conversation` and `Message`:

```typescript
interface Task {
  id: string;
  title: string;
  prompt: string;
  provider: "codex" | "claude";
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
  workspace?: string;
  createdAt: Date;
  completedAt?: Date;
}
```

Provider events are normalized before reaching the UI:

```typescript
type AgentEvent =
  | { type: "started" }
  | { type: "thinking"; message?: string }
  | { type: "tool"; tool: string; detail?: string }
  | { type: "output"; content: string }
  | { type: "completed"; result: string }
  | { type: "cancelled" }
  | { type: "error"; error: string };
```

The Phase 02 `CodexProvider` spawns `codex exec --json` with an argv array and the selected workspace as `cwd`, parses JSONL incrementally, and turns process failures or malformed events into error events. It does not forward raw stdout to the renderer. Phase 11 added a Claude Code provider behind the same interface.

Phase 02 gives Codex a strict named permission profile: deny `:root`, allow `:minimal` platform paths and the selected `:workspace_roots` as read-only, and disable command network access. The task ignores user-level Codex config so an existing broad sandbox setting cannot replace Poko's policy; Codex authentication remains in the user's Codex home. Unsupported profile configuration fails closed, with no broad read-only fallback. The permission contract includes a future `write` mode, but the Phase 02 UI only submits read-only tasks until the in-app approval and write policy are implemented. Phase 03 persists task, conversation, Activity, workspace, and explicit memory records.

`codex exec --json` is intentionally non-interactive and is not the approval transport. In Phase 04 the main process runs `CodexAppServerProvider`, a per-task `codex app-server --listen stdio://` child speaking JSONL JSON-RPC, so it can receive and answer one-shot command/file approval requests. Agent Core and the Poko event model are unchanged; approval requests become `approvalRequired` events. Requests that are malformed, outside the workspace, broaden network or exec policy, or use an unsupported method are declined or stop the task. Phase 04 kept tasks read-only; Phase 08 added approved file edits with checkpoints and undo, and Phase 12 added approved commands inside a sandbox on Claude Code. See [the Phase 04 plan](phases/phase-04.md).

In Phase 05 the main process builds a `TaskContext` for each task before it starts: saved memories by importance, and the most recent completed exchanges from the task's conversation (`tasks.conversation_id`, `tasks.result`), capped by count and characters in `electron/agent/context.ts`. Agent Core formats it into the prompt between the project guidance and the user request. Memories are labeled as user-written facts that never override the safety rules. Assistant answers render as Markdown in the renderer, with raw HTML escaped, links that don't navigate, and images that don't load. They stream in from `output` deltas grouped by agent message item. Partial answers are never persisted. See [the Phase 05 plan](phases/phase-05.md).

## Workspace and permission boundary

The native folder picker selects the workspace. The selected path is persisted as an app setting. A selected workspace is the working root for an agent task; it is not by itself a complete operating-system sandbox. Before running a provider, the main process must canonicalize and validate the working directory, and provider permissions must be configured explicitly.

Classify operations as:

- **Safe:** read, search, analysis, and explicitly allowed tests.
- **Write:** create or modify files, or install dependencies; apply the selected task mode and approval policy.
- **Dangerous:** delete data, push, reset, deploy, or affect an external service; require explicit user approval for the concrete action.

Phase 01 has no shell or provider execution. Phase 02 uses Codex's restricted read-only permission profile. Phase 04 adds the user approval UI, Phase 08 approved edits, and Phase 12 sandboxed commands. Never claim that a confirmation dialog alone confines a process to the workspace.

## Persistence model

Phase 03 uses Drizzle ORM with Node's built-in `node:sqlite` driver and stores the database under Electron `userData`. Electron 44.4.5 bundles Node 24.21.0; the built-in driver avoids a native npm addon and the Electron ABI rebuild it would require. Drizzle ORM and Drizzle Kit are pinned to `1.0.0-rc.4` because stable `0.45.3` does not include the Node SQLite adapter; this prerelease dependency risk should be revisited when a stable adapter is available. Because `DatabaseSync` is synchronous, keep database queries short and confined to the main process. Use versioned Drizzle SQL migrations at startup.

The initial schema is:

| Table | Responsibility | Initial fields |
| --- | --- | --- |
| `settings` | app preferences and workspace | `key`, `value`, `updated_at` |
| `conversations` | conversation identity | `id`, `title`, `created_at`, `updated_at` |
| `messages` | user and assistant messages | `id`, `conversation_id`, `role`, `content`, `created_at` |
| `tasks` | provider work lifecycle | `id`, `title`, `prompt`, `provider`, `status`, `workspace`, `created_at`, `completed_at` |
| `activities` | user-readable and technical timeline | `id`, `task_id`, `type`, `message`, `created_at` |
| `memories` | explicit searchable personal/project facts | `id`, `type`, `content`, `importance`, `source`, `created_at`, `updated_at` |

Later migrations added `tasks.conversation_id` and `tasks.result` (Phase 05), the `approvals` (Phase 04), `edits` (Phase 08), and `routines` (Phase 15) tables, and `workspace_path` on conversations and memories (Phase 16); `electron/database/schema.ts` is the current schema.

Add foreign keys and indexes with the first migration. Import the existing workspace path from `settings.json` into the settings row only when no database value exists; retain the old file during migration. Mark tasks left in `running` at an unclean shutdown as failed on next startup. Persist explicit memory records with parameterized literal text search. A memory is saved only when the user writes it or says yes to a suggestion; there is no vector database. SQLite content is local but unencrypted in v0.1, so keep API keys and tokens out of it. Close the database after workers stop during app shutdown.

## Deferred extension points

- `src/tools/browser`: Playwright integration, not planned. Browser tasks go through the screen helper instead.
- Running routines while Poko is quit (a login item or launch agent).
- `skills/`: prompt guidance loaded by the Agent Core; `skills/coding` is the only one today.

The Claude Code provider (`electron/providers/claude`, Phase 11), the screen companion (`electron/screen`, Phase 06), and routines (`electron/routines`, Phase 15) were seams here and now exist.

These are documented seams, not empty packages to scaffold in advance.

## Phase 01 implementation

The app uses Electron Vite's main, preload, and renderer processes. Phase 03 imports a previous workspace path from the legacy JSON settings file if the SQLite setting is empty; new preference writes go directly to SQLite. The preload exposes persistence through narrow typed methods. Later phases added approval-gated writes (Phase 08), memory suggestions saved only on yes, and routines (Phase 15).

## Screen companion (Phase 06)

Phase 06 adds privileged main-process capabilities, all behind narrow IPC:
- capturing a window the user picks (`desktopCapturer`)
- reading and acting on its accessibility elements through a bundled Swift helper (window identity by CGWindowID, pid, and frame; semantic `AXPress` and `AXValue` actions only)
- a transparent, click-through overlay `BrowserWindow` for the character
- a global stop shortcut

The renderer never captures, reads, or acts on other apps. Each action is approved individually, re-verified right before it runs, and limited to the picked app. During a screen task, Codex runs with a permission profile that reads only an empty temp folder, and its command and file-change requests are declined; Claude Code runs with no tools at all (Phase 11). Actions are limited to the web content of `http`/`https` pages in browsers. Browser automation (Playwright) remains out of scope.

## Routines (Phase 15)

Routines are the first work Poko starts on its own, so they get a narrower boundary than tasks the user starts:
- **Read-only, always:** `startRoutineTask` (`electron/app/routines.ts`) forces `editsEnabled: false`, and Agent Core's `routine` flag uses an unattended read-only prompt with no memory suggestion. Command approvals are declined as in any read-only task.
- **Same guards as a message:** a run counts in `startingTasks`, refuses while data is being deleted, checks busy before and after resolving the routine's folder, and records nothing until it can start.
- **Its own conversation:** a run is recorded in the routine's 🔁 conversation and doesn't change the active conversation. The main window learns about it through `taskStarted`, and takes it over only if that conversation is on screen.
- **Scheduling is pure and tested:** `electron/routines/schedule.ts` computes daily and weekly times from local calendar fields, and counts intervals from when the routine was last set:
  - every scheduled time is handled once (`lastSlotAt`), run or skipped;
  - a time before the routine was last set (`scheduleChangedAt`) never runs;
  - a missed time runs only on its own day, or within 35 minutes across midnight.
- **The timer lives in main:** `RoutineRunner` is checked every minute, at startup, and on wake or unlock, and runs one routine at a time. It runs only while Poko runs; a login item or launch agent is deferred.

## Folders (Phase 16)

A conversation and a 프로젝트 or 결정 memory belong to a folder (`workspace_path`, a resolved real path):
- A conversation takes the folder of its first task with a real path; a follow-up from another selected folder is refused, and the user switches with `workspace:use-conversation-folder`, which sends no path from the renderer.
- A task's context gets shared memories plus its own folder's; a screen task gets only shared ones.
- Main decides a memory's folder: a suggestion's comes from the task that made it, a typed one from the selected folder. See [Phase 16](phases/phase-16.md).
