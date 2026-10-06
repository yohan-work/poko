# Phase 15 — Routines

## Goal

Let the user give Poko work that repeats on a schedule ("매일 아침 9시에 이 폴더 변경 사항 정리해 줘"), run it without being asked each time, and find the results waiting.

A routine starts without the user's approval each time, so it is held to a narrower boundary than a task the user starts.

## Decisions (agreed with the user, 2026-10-06)

- **Always read-only.**
  - A routine runs read-only whatever the folder's edit setting is: no file changes and no commands. It reads, summarizes, checks, and reports.
  - If the work needs changes, the answer says so, and the user continues in that conversation.
- **Missed runs:** if Poko was closed or the Mac was asleep at the scheduled time, the routine runs **once** when Poko is running again on **the same day**. A run missed on an earlier day is skipped.
- **One conversation per routine:** each routine has its own conversation (🔁 title). Every run adds the routine's request and the answer to it, and a notification says the result is ready.

## What the user experiences

- **The 루틴 page** in the sidebar lists the routines. Each shows its title, schedule, next run, and last result (finished, failed, or skipped).
- **Adding a routine:**
  - a title;
  - what to do (the request, as it would be typed in the message box);
  - when to run it:
    - every day at a time;
    - on chosen weekdays at a time;
    - every N hours (1–24) while Poko is running.
- **Each routine** has an on/off switch, **지금 실행** (run now), edit, and delete. Deleting a routine keeps its conversation.
- **Folder:** a routine runs in the folder that was selected when it was created, and the page shows it. If the folder is gone, the run is skipped and the reason is shown.
- **Running:**
  - The result appears in the routine's conversation, and Activity shows the run like any task.
  - A notification follows the existing rule: shown when no Poko window is focused, and the setting can turn it off.
- **Poko must be running.** Poko keeps running in the menu bar after its window closes. The page says routines don't run while Poko is quit.

## Design

- **Storage:**
  - a `routines` table, added in a migration: `id`, `title`, `prompt`, `schedule` (JSON), `workspacePath`, `conversationId`, `enabled`, `scheduleChangedAt`, `lastSlotAt`, `lastRunAt`, `lastResult`, `createdAt`;
  - `schedule` is validated in main: `{ kind: "daily", time }`, `{ kind: "weekly", days, time }`, or `{ kind: "interval", hours }`;
  - `conversationId` references `conversations` with `ON DELETE SET NULL`. If the user deletes the routine's conversation, the routine stays, and its next run creates a new 🔁 conversation;
  - the 🔁 conversation is created explicitly, titled "🔁 {title}", rather than titled from the first message;
  - 모든 데이터 삭제 deletes routines too, since they are the user's data.
- **Scheduler** (`electron/routines/`):
  - a pure `nextRun(schedule, after)` function and a pure `dueRuns(routines, now)` function, both unit-tested with fixed clocks;
  - **a slot is due** when it is after `lastSlotAt` and after `scheduleChangedAt` (set when the routine is created, edited, or turned back on), and on the same local day as `now` or at most 35 minutes old (so a run just before midnight, or one waiting for Poko, isn't lost). Creating or editing a routine therefore never runs it for a time already past;
  - **every outcome marks its slot handled.** A run, a skip because the folder is gone, and a skip after the busy wait all set `lastSlotAt`, so the same slot is never retried;
  - a one-minute timer in main, which also checks right after startup and after `powerMonitor` `resume` / `unlock-screen`;
  - times are local. Daylight-saving changes are handled by computing slots from local calendar fields.
- **Running a routine:** `startRoutineTask(routine)` in `electron/app/routines.ts` is the routine's own entry point, sharing the message path's guards:
  - it counts in `startingTasks` and refuses while 모든 데이터 삭제 is running, like `handleTaskStart`;
  - it checks busy before and after resolving the folder, like `startConversationTask`;
  - it uses the **routine's** folder, not the selected one;
  - it records the task with the routine's request as the shown text, and passes the engine prompt separately;
  - it forces `editsEnabled: false` and `suggestMemory: false`;
  - screen tasks and attachments are never part of a routine.
- **Agent Core:**
  - a `routine` flag replaces the read-only advice to press '읽기 전용' (wrong here) with: "This is a scheduled, unattended, read-only run. Don't ask follow-up questions. If changes are needed, describe them; the user can continue in this conversation.";
  - `suggestMemory: false` leaves out the memory note and doesn't parse a tag, so a run never offers a memory card;
  - command approvals are always declined, as in read-only conversations.
- **Reaching the main window:**
  - the runner sends `taskStarted` as soon as the task is recorded, as the quick panel does, so the run appears in the task and conversation lists;
  - if the window is showing the routine's conversation, it takes the run over at once (the existing `adoptTask`), so the request and the answer appear live;
  - `focusConversation` (a notification click) reloads the conversation even when it is already shown, so a run that ended in the background is never left hidden.
- **Busy:**
  - Poko runs one task at a time. If another task is running when a routine is due, the routine waits and is checked again each minute.
  - After 30 minutes the slot is skipped, and `lastResult` says why.
  - Two routines due together run one after another.
- **Continuing in a routine's conversation:**
  - a follow-up message there runs in the routine's folder only;
  - if a different folder is selected, main refuses with "이 대화는 {folder} 폴더의 루틴이야. 그 폴더를 고른 뒤 이어서 물어봐 줘.", so a follow-up (possibly with edits on) never runs against the wrong project.
- **Renderer:**
  - the 루틴 page sends routine fields through narrow, typed IPC (`routines:list/save/delete/run`), and main validates everything again;
  - the renderer never picks the folder by path; a new routine takes the current workspace in main.

## Milestones (one PR each)

1. **Storage and scheduler:** the migration, validation, `nextRun` / `dueRuns`, `startRoutineTask` with its guards, the Agent Core flags, and the `taskStarted` notice. Tests use a fake clock and cover:
   - catch-up only after `scheduleChangedAt`;
   - every outcome marking its slot handled;
   - the busy wait;
   - a missing folder;
   - a deleted conversation.

   No UI yet; it is checked through tests and a dev-only IPC call.
2. **The 루틴 page and the window:**
   - the page: the list, the add/edit form, the switch, 지금 실행, delete, and last results;
   - the window: live take-over of a run in the shown conversation, the notification reload, and the folder check for follow-ups.

   Includes a real-app check of a routine that runs a minute after it is created.
3. **Finish:** README, architecture notes, and the resume list.

## Explicitly deferred

- Routines that change files or run commands.
- Running while Poko is quit (a launch agent or login item).
- Poko proposing a routine from the conversation, e.g. from a `routine` memory.
- Sending results anywhere outside Poko (email, Slack).

## Status

- **Milestone 1 (storage and scheduler) is done.**
  - It includes the `routines:list/save/delete/run` IPC that the page will use. The checks run in main.
  - Run results go to `lastResult` when the task ends (`recordRoutineEnd` in `deliverTaskEvent`).
- **Milestone 2 (the page and the window) is done.**
  - **The page:** 루틴 in the sidebar lists the routines with schedule, folder, next run, and last result. From there the user can add, edit, switch on or off, 지금 실행, open the conversation, and delete (in two steps). The list refreshes every 15 seconds while the page is open.
  - **The window:**
    - a run that starts in the conversation on screen is taken over at once, so it streams;
    - a notification click on the conversation already shown reloads it;
    - a follow-up in a routine's conversation is refused unless the routine's folder is selected.

