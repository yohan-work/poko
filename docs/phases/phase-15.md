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
  - a `routines` table, added in a migration: `id`, `title`, `prompt`, `schedule` (JSON), `workspacePath`, `conversationId`, `enabled`, `lastRunAt`, `lastResult`, `createdAt`;
  - `schedule` is validated in main: `{ kind: "daily", time }`, `{ kind: "weekly", days, time }`, or `{ kind: "interval", hours }`.
- **Scheduler** (`electron/routines/`):
  - a pure `nextRun(schedule, after)` function and a pure `dueRuns(routines, now, lastCheck)` function, both unit-tested with fixed clocks, including the same-day catch-up rule;
  - a one-minute timer in main, which also checks right after startup and after `powerMonitor` `resume` / `unlock-screen`;
  - times are local, and daylight-saving changes are handled by computing the next run from local calendar fields.
- **Running a routine:**
  - it goes through the same path as a message (`recordTaskStart` and Agent Core), in the routine's conversation, with the profile forced read-only (`editsEnabled: false`);
  - command approvals are always declined, as in read-only conversations;
  - screen tasks and attachments are never part of a routine.
- **Busy:**
  - Poko runs one task at a time. If another task is running when a routine is due, the routine waits and is checked again each minute.
  - After 30 minutes it is skipped, and `lastResult` says why.
  - Two routines due together run one after another.
- **Prompt:**
  - the run prefixes the request with one line telling the engine this is a scheduled, unattended, read-only run, so it doesn't ask follow-up questions;
  - memory suggestions are not taken from routine runs, because the user didn't say anything this time.
- **Renderer:**
  - the 루틴 page sends routine fields through narrow, typed IPC (`routines:list/save/delete/run`), and main validates everything again;
  - the renderer never picks the folder by path; a new routine takes the current workspace in main.
  - A run appears in the main window like a task started elsewhere (the existing foreign-task path), so a window showing another conversation is never switched.

## Milestones (one PR each)

1. **Storage and scheduler:** the migration, validation, `nextRun` / `dueRuns`, the runner in main, and tests (fake clock, busy wait, catch-up, folder missing). No UI yet; checked through tests and a dev-only IPC call.
2. **The 루틴 page:** the list, the add/edit form, the switch, 지금 실행, delete, and last results. Includes a real-app check of a routine that runs a minute after it is created.
3. **Finish:** README, architecture notes, and the resume list.

## Explicitly deferred

- Routines that change files or run commands.
- Running while Poko is quit (a launch agent or login item).
- Poko proposing a routine from the conversation, e.g. from a `routine` memory.
- Sending results anywhere outside Poko (email, Slack).
