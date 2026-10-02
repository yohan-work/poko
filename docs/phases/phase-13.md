# Phase 13 — Ask Poko from anywhere

## Goal

Summon Poko without switching apps: a global shortcut or the menu bar icon opens a small panel over whatever the user is doing. They ask, watch the answer stream in, and continue in the app if they want. Poko should feel like a companion that is always there, not a window to go find.

## Today

- Poko lives in one main window. Closing it cancels running tasks (`electron/main.ts`, the `closed` handler), and on macOS the app keeps running with no window and no way to reach it except the Dock.
- Only the main window's renderer is trusted for IPC (`isTrustedRenderer` in `electron/app/context.ts`). The overlay window gets events but calls nothing.
- The only global shortcut is ⌘⇧Esc, which stops a screen task.

## What the user experiences

1. **Shortcut:** **⌥Space** opens the quick panel by default.
   - 설정 offers ⌥Space, ⌥⇧Space, or 끄기.
   - If another app already owns the shortcut, 설정 says so ("다른 앱이 이 단축키를 쓰고 있어") and the menu bar icon still works.
2. **Menu bar:** a small Poko icon with three items:
   - **포코에게 묻기** (with the shortcut);
   - **포코 열기**;
   - **종료**.
3. **The quick panel:**
   - a rounded panel near the top of the screen under the mouse, above other windows, holding the character and one input;
   - Enter asks, and the answer streams below as markdown, with the character's state as usual;
   - **앱에서 이어서** opens the main window on that conversation;
   - Esc hides the panel. Hiding never cancels a task, and opening the panel again shows its progress;
   - each quick question starts a **new conversation** in the selected workspace, with the current engine, model, and edit setting.
4. **Approvals stay in the main window.** If the task needs one, the panel says "확인이 필요해. 앱에서 확인해 줘." with a button that opens the main window on the card. There is one place to approve, so the panel can never approve on its own.
5. **Busy or not ready:** if a task is already running, the panel says so and offers 앱에서 보기. If no workspace is selected or setup isn't ready, the panel says what is missing and opens the app.
6. **Closing the main window** on macOS hides it instead of destroying it. Tasks keep running, and the menu bar icon and shortcut keep working. **종료** (or ⌘Q) quits as before, still waiting for tasks to cancel.

## Design

- **`QuickPanel`** (`electron/quick/QuickPanel.ts`), shaped like `ScreenOverlay`:
  - a frameless, transparent, always-on-top `BrowserWindow`;
  - it loads the renderer with `#quick`, uses the same preload, keeps the sandbox on, and blocks navigation and new windows;
  - it shows on the display under the cursor and hides on Esc. A blur hides it only while nothing is typed and no task runs.
- **Narrow trust:**
  - New channels `quick:ask`, `quick:open-in-app`, `quick:hide`, and `quick:state` (main → panel).
  - Their handlers accept only the panel's own webContents and main frame (`isQuickPanel`).
  - Every existing handler keeps `isTrustedRenderer` (main window only), so the panel can't read data, change settings, answer approvals, or start screen tasks.
  - The renderer's `#quick` page uses only `window.poko.quick`.
- **Starting a task:**
  - The task start in `electron/app/tasks.ts` moves into a shared function, `startConversationTask(message, conversationId | null)`. It does the workspace and setup checks, records the start, and calls `agentCore.startTask`, so both entry points behave the same.
  - The shared function refuses **before recording anything** while a task is running or starting (`anyTaskBusy()`), like `screen.ts` does. A busy refusal never creates a conversation, a task row, or a new active conversation. This also covers the main window, which is no longer "sending" while a quick task runs.
  - `quick:ask` is registered through `handleTaskStart`, like `task:start`, so it gets the same start guards: refusal while 모든 데이터 삭제 runs, and the starting counts that `anyTaskBusy()` relies on.
  - It calls the shared function with `null`, which means a new conversation.
- **The main window adopts tasks it didn't start.**
  - Today the main window listens to task events only inside its own send, and drops other tasks' events, so it would never see a quick task's approval card.
  - **One listener for every task event.** The per-send subscription in `runTask` is replaced by a single app-level listener in the store, which routes each event:
    - **To the shown task:** an event whose task is `activeTaskId` (the window's own send or an adopted task) goes to `applyTaskEvent`, as today.
    - **Held during a send's start:** while the window's own send is starting (its task id not known yet), every event is held in arrival order.
      - When the start reply arrives, the held events for that task id are applied in order, and the rest go to foreign handling.
      - If the start is refused, all held events go to foreign handling.
      - Nothing is dropped.
    - **Otherwise:** foreign handling.
  - **Foreign handling:**
    - adds the conversation and task to the lists and tracks the task's status;
    - keeps its approval events aside, keyed by `requestId`, so nothing is added twice.
  - **Adopting** (`adoptTask`) happens whenever the conversation holding a foreign running task is shown, not only on a switch:
    - **When it runs:** at bootstrap, after `task:active`, on `app:focus-conversation`, on the banner's 보기, and after a switch. A request for the conversation already shown still adopts.
    - **Order:** it sets `activeTaskId` **first**, before any await. From then on the listener applies that task's events through `applyTaskEvent`, with the same streaming, cards, and completion as the window's own send.
      - While the conversation's messages load, that task's events are held, using the same mechanism as a starting send, and applied after the messages are in place. Nothing is dropped or shown in the wrong conversation.
    - **Re-check:** before setting `isSending`, it re-checks with main (`task:active`) that the task is still running.
      - If it already ended, the window stays idle and reloads the conversation, which then holds the final answer.
      - Any held terminal event is applied normally.
    - **Cards:** the kept approval cards move into `pendingApprovals`.
  - **Cards and the banner:** a foreign task's card is never shown in another conversation. When a card arrives, the window shows a banner in the open conversation: "다른 대화에서 확인이 필요해 · 보기". It switches to and adopts that conversation, which is allowed while busy because it holds the running task.
  - **One task at a time:** while a foreign task runs, the composer's send is disabled with "포코가 다른 작업 중이야", the same as during the window's own task, and main refuses a busy start before recording anything.
  - When the window is created or reloaded, it asks main for the active task and its pending approvals with a new `task:active` (main-window only), so a card raised while the window was hidden is still there.
- **Panel updates:**
  - `deliverTaskEvent` also sends a reduced view of the panel's own task to the panel: status, text deltas, the final answer or error, and "needs approval".
  - The panel gets no raw CLI output and no approval details. It keeps only the latest quick task.
- **Opening in the app:**
  - `quick:open-in-app` shows the main window, creating it if needed, and pushes `app:focus-conversation` with the conversation and task.
  - The renderer switches to that conversation and adopts the task.
  - `conversation:open` refuses while a task runs, except for the conversation that holds the running task, which is the one being focused. Switching anywhere else stays refused.
- **Shortcut:**
  - `settings.quickShortcut` holds `"Alt+Space"` (the default), `"Alt+Shift+Space"`, or `"off"`, validated in `setSettings`.
  - Main registers it with `globalShortcut` at startup and on change, and records whether registration succeeded so 설정 can show it.
  - ⌘⇧Esc is unaffected.
- **Menu bar:**
  - `Tray` with a template image: a monochrome Poko head, 16 and 32 px, so macOS tints it for light and dark menu bars;
  - the images live in `resources/tray/` and ship through `extraResources` (like `poko-ax`). They are read from `process.resourcesPath` when packaged and from the app path in development. The packaged-app check opens the built `.app`;
  - the menu holds the three items above.
- **Main window close (macOS):**
  - `close` is intercepted to `hide()` unless the app is quitting (a flag set in `before-quit`).
  - The existing `closed` cleanup (cancel tasks, destroy the overlay) runs only when the window is really destroyed at quit.
  - `activate` (a Dock click) shows the hidden main window, or creates it if there is none. It no longer checks `getAllWindows().length`, because the hidden window, the panel, and the overlay all count.
  - Other platforms are unchanged.
- **Renderer:**
  - `#quick` renders `QuickPanel.tsx`: the character, the input, the streaming answer with `Markdown`, and the buttons.
  - It has a small store, separate from the app store.

## Milestones

1. **Quick panel and shortcut:**
   - the panel, narrow IPC, the shared task start, streaming, open in app, approval hand-off;
   - the shortcut setting;
   - hide-on-close for the main window.
2. **Menu bar icon:** the tray, its template images, and its menu.

## Acceptance criteria

- **Unit tests:**
  - the panel's channels refuse the main window and other senders, and existing channels refuse the panel;
  - the store adopting a foreign task:
    - approval cards are kept, never duplicated, and never shown in another conversation;
    - the banner;
    - streaming and completion;
    - one listener routes every event: held events during a start are applied to the started task, or handed to foreign handling when the start is refused, and nothing is dropped;
    - an adopted task's later events, including streaming, new cards, and completion, are applied;
    - adoption happens when the conversation is already shown (bootstrap, `task:active`, a focus on the same conversation);
    - events during the conversation load are held, not dropped;
    - a task that ended during adoption leaves the window idle;
  - a busy start (quick or main window) records nothing;
  - `conversation:open` while busy is allowed only for the running task's conversation;
  - the shared task start (no workspace, busy, setup not ready, success);
  - the shortcut setting validation;
  - the panel store reducing task events, including approval hand-off and errors.
- **Real run:**
  - ⌥Space opens the panel over another app, a question streams an answer, and 앱에서 이어서 opens that conversation;
  - Esc hides the panel during a task, and reopening shows the progress;
  - an edit request shows the approval hand-off, and the main window shows the card;
  - closing the main window keeps the app and shortcut alive, a Dock click brings it back, and ⌘Q quits;
  - a quick task that needs approval while the main window is hidden shows its card when the window opens;
  - the tray menu works in light and dark menu bars, including in the packaged app.
- CI passes, plus a GUI check of the panel in light and dark.

## Explicitly deferred

- Asking about the window under the panel (화면과 함께 묻기). It builds on 화면 보기 and is a natural next step.
- Custom shortcut recording.
- Continuing an existing conversation from the panel.
- Approving inside the panel.

## Status

Milestone 1 is implemented: the quick panel, the shortcut, the shared start, adoption, and hide-on-close.

Real runs found two things the plan didn't cover:
- **Window height:** the panel window follows the panel's content height (`quick:resize`), because the transparent part of a fixed-size window still blocked clicks to the app below.
- **Test-only failure:** the store's one-time subscriptions are guarded for environments without `window`, since a test that imports a component pulling in the store failed to load.

Verified in the built app:
- ⌥Space opened the panel over another app, and the question streamed an answer while the main window's send was disabled.
- 앱에서 이어서 opened that conversation with the question and the answer.
- The panel couldn't call main-window channels, and the main window couldn't call the panel's.
- Esc hid the panel.
- The close button hid the main window: the app and the shortcut kept working.

**Milestone 2 is implemented.**
- `electron/quick/tray.ts` shows a template image (`resources/tray/trayTemplate.png` and `@2x`, drawn by `scripts/tray-icon.swift` from the app icon's shapes) with three items: 포코에게 묻기, which shows the current shortcut, 포코 열기, and 종료. The menu is rebuilt when the shortcut changes.
- The images ship through `extraResources` (`tray/`).
- Verified in the **packaged** app (`pnpm dist`, opened with a separate data folder):
  - the menu bar item appears with the three items;
  - 포코에게 묻기 opens the panel (1 → 2 windows);
  - 종료 quits the app.
