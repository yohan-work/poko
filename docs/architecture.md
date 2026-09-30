# Poko architecture

Poko is a local-first desktop character that accepts a user's request, decides whether work should run, delegates that work to an agent provider, and presents a concise result. The first release is an Electron application with a character-led conversation UI and a read-only Codex CLI worker.

## Scope and implementation shape

Start as one pnpm application rather than a multi-package workspace. Keep clear module boundaries in the source tree and extract packages only when multiple consumers or independent releases require them.

```text
.
├── electron/
│   ├── main.ts              # lifecycle, window, native dialogs, settings, Agent Core entry
│   ├── preload.ts           # narrow, typed renderer bridge
│   ├── settings.ts          # persisted workspace preference
│   ├── shared.ts            # IPC channels and domain types
│   ├── agent/               # Agent Core and provider contract
│   └── providers/codex/     # Codex CLI process and JSONL adapter
├── src/renderer/
│   ├── index.html
│   └── src/
│       ├── components/
│       │   ├── character/   # character states
│       │   ├── chat/        # conversation UI
│       │   └── activity/    # in-memory activity view
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
| `activity.list` | renderer → main | 03 | Returns persisted activity records |

Cancellation and approval responses will be added as explicit operations when those flows are implemented. Do not create a generic IPC escape hatch.

## Agent Core and provider contracts

The Agent Core is the only layer that converts a user request into a task and selects a provider. Phase 01 used a mock response; Phase 02 sends analysis tasks to Codex through a read-only sandbox.

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
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed";
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

Phase 02 runs Codex with `--sandbox read-only --ask-for-approval on-request`; it does not grant workspace writes, network access, extra writable paths, or approval bypass. The permission contract includes a future `write` mode, but the Phase 02 UI only submits read-only tasks until the in-app approval and write policy are implemented. The user-facing Activity view is in-memory and is cleared when the app restarts.

## Workspace and permission boundary

The native folder picker selects the workspace. The selected path is persisted as an app setting. A selected workspace is the working root for an agent task; it is not by itself a complete operating-system sandbox. Before running a provider, the main process must canonicalize and validate the working directory, and provider permissions must be configured explicitly.

Classify operations as:

- **Safe:** read, search, analysis, and explicitly allowed tests.
- **Write:** create or modify files, or install dependencies; apply the selected task mode and approval policy.
- **Dangerous:** delete data, push, reset, deploy, or affect an external service; require explicit user approval for the concrete action.

Phase 01 has no shell or provider execution. Phase 02 uses Codex's read-only sandbox. Phase 04 adds the user approval UI and a write policy. Never claim that a confirmation dialog alone confines a process to the workspace.

## Persistence model

Use SQLite with Drizzle when persistence is introduced in Phase 03. The initial schema is:

| Table | Responsibility | Initial fields |
| --- | --- | --- |
| `settings` | app preferences and workspace | `key`, `value`, `updated_at` |
| `conversations` | conversation identity | `id`, `title`, `created_at`, `updated_at` |
| `messages` | user and assistant messages | `id`, `conversation_id`, `role`, `content`, `created_at` |
| `tasks` | provider work lifecycle | fields from the `Task` contract plus serialized result metadata |
| `activities` | user-readable and technical timeline | `id`, `task_id`, `type`, `message`, `created_at` |
| `memories` | explicit searchable personal/project facts | `id`, `type`, `content`, `importance`, `source`, `created_at`, `updated_at` |

Add foreign keys and indexes with the first migration. Memory begins with text search; do not add a vector database. Keep credentials out of SQLite and use the operating-system credential store if credentials are needed in a later phase.

## Deferred extension points

- `src/providers/claude`: future provider, no implementation in v0.1.
- `src/tools/browser`: future Playwright integration, no browser automation in v0.1.
- `src/agent/scheduler`: future routines and scheduling, no scheduler in v0.1.
- `skills/`: prompt guidance loaded by the Agent Core; begin with the coding skill when Codex integration lands.

These are documented seams, not empty packages to scaffold in advance.

## Phase 01 implementation

The app uses Electron Vite's main, preload, and renderer processes. Electron main persists only the selected workspace as a small JSON settings file under `app.getPath("userData")`; conversation messages remain in memory. The preload exposes workspace selection and task start/cancel/event subscriptions as narrow typed methods. Phase 02 delegates read-only project analysis to Codex. File edits, SQLite persistence, automatic memory extraction, browser automation, scheduling, and approval-gated writes remain out of scope until their planned phases.
