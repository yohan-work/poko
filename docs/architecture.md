# Poko architecture

Poko is a local-first desktop character that accepts a user's request, decides whether work should run, delegates that work to an agent provider, and presents a concise result. The first release is an Electron application with a character-led conversation UI and a read-only Codex CLI worker.

## Scope and implementation shape

Start as one pnpm application rather than a multi-package workspace. Keep clear module boundaries in the source tree and extract packages only when multiple consumers or independent releases require them.

```text
.
├── electron/
│   ├── main.ts              # lifecycle, window, native dialogs, settings, Agent Core entry
│   ├── preload.ts           # narrow, typed renderer bridge
│   ├── settings.ts          # legacy workspace settings import helpers
│   ├── shared.ts            # IPC channels and domain types
│   ├── database/            # SQLite connection, schema, and persistence
│   ├── agent/               # Agent Core and provider contract
│   └── providers/codex/     # Codex CLI process and JSONL adapter
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

The Phase 02 `CodexProvider` spawns `codex exec --json` with an argv array and the selected workspace as `cwd`, parses JSONL incrementally, and turns process failures or malformed events into error events. It does not forward raw stdout to the renderer. A Claude provider can implement the same interface later.

Phase 02 gives Codex a strict named permission profile: deny `:root`, allow `:minimal` platform paths and the selected `:workspace_roots` as read-only, and disable command network access. The task ignores user-level Codex config so an existing broad sandbox setting cannot replace Poko's policy; Codex authentication remains in the user's Codex home. Unsupported profile configuration fails closed, with no broad read-only fallback. The permission contract includes a future `write` mode, but the Phase 02 UI only submits read-only tasks until the in-app approval and write policy are implemented. Phase 03 persists task, conversation, Activity, workspace, and explicit memory records.

`codex exec --json` is intentionally non-interactive and is not the approval transport. In Phase 04 the main process runs `CodexAppServerProvider`, a per-task `codex app-server --listen stdio://` child speaking JSONL JSON-RPC, so it can receive and answer one-shot command/file approval requests. Agent Core and the Poko event model are unchanged; approval requests become `approvalRequired` events. Requests that are malformed, outside the workspace, broaden network or exec policy, or use an unsupported method are declined or stop the task. Tasks still run in read-only mode; writes stay disabled until pause-before-action semantics and sandbox enforcement are verified on supported operating systems. See [the Phase 04 plan](phases/phase-04.md).

In Phase 05 the main process builds a `TaskContext` for each task before it starts: saved memories by importance, and the most recent completed exchanges from the task's conversation (`tasks.conversation_id`, `tasks.result`), capped by count and characters in `electron/agent/context.ts`. Agent Core formats it into the prompt between the project guidance and the user request. Memories are labeled as user-written facts that never override the safety rules. Assistant answers render as Markdown in the renderer, with raw HTML escaped, links that don't navigate, and images that don't load. They stream in from `output` deltas grouped by agent message item. Partial answers are never persisted. See [the Phase 05 plan](phases/phase-05.md).

## Workspace and permission boundary

The native folder picker selects the workspace. The selected path is persisted as an app setting. A selected workspace is the working root for an agent task; it is not by itself a complete operating-system sandbox. Before running a provider, the main process must canonicalize and validate the working directory, and provider permissions must be configured explicitly.

Classify operations as:

- **Safe:** read, search, analysis, and explicitly allowed tests.
- **Write:** create or modify files, or install dependencies; apply the selected task mode and approval policy.
- **Dangerous:** delete data, push, reset, deploy, or affect an external service; require explicit user approval for the concrete action.

Phase 01 has no shell or provider execution. Phase 02 uses Codex's restricted read-only permission profile. Phase 04 adds the user approval UI and a write policy. Never claim that a confirmation dialog alone confines a process to the workspace.

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

Add foreign keys and indexes with the first migration. Import the existing workspace path from `settings.json` into the settings row only when no database value exists; retain the old file during migration. Mark tasks left in `running` at an unclean shutdown as failed on next startup. Persist explicit memory records with parameterized literal text search; do not add automatic memory extraction or a vector database. SQLite content is local but unencrypted in v0.1, so keep API keys and tokens out of it. Close the database after workers stop during app shutdown.

## Deferred extension points

- `src/providers/claude`: future provider, no implementation in v0.1.
- `src/tools/browser`: future Playwright integration, no browser automation in v0.1.
- `electron/agent/screen`: Phase 06 screen companion. Main-process window capture, a Swift accessibility helper, one-approved-step actions, and the overlay window. See [Phase 06](phases/phase-06.md).
- `src/agent/scheduler`: future routines and scheduling, no scheduler in v0.1.
- `skills/`: prompt guidance loaded by the Agent Core; begin with the coding skill when Codex integration lands.

These are documented seams, not empty packages to scaffold in advance.

## Phase 01 implementation

The app uses Electron Vite's main, preload, and renderer processes. Phase 03 imports a previous workspace path from the legacy JSON settings file if the SQLite setting is empty; new preference writes go directly to SQLite. The preload exposes persistence through narrow typed methods. Automatic memory extraction, browser automation, scheduling, and approval-gated writes remain out of scope until their planned phases.

## Screen companion (Phase 06)

Phase 06 adds privileged main-process capabilities, all behind narrow IPC:
- capturing a window the user picks (`desktopCapturer`)
- reading and acting on its accessibility elements through a bundled Swift helper (window identity by CGWindowID, pid, and frame; semantic `AXPress` and `AXValue` actions only)
- a transparent, click-through overlay `BrowserWindow` for the character
- a global stop shortcut

The renderer never captures, reads, or acts on other apps. Each action is approved individually, re-verified right before it runs, and limited to the picked app. During a screen task, Codex runs with a permission profile that only reads an empty temp folder (verified with a real run), and its command and file-change requests are declined. Actions are limited to the web content of `http`/`https` pages in browsers. Browser automation (Playwright) remains out of scope.
