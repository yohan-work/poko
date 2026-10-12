# Phase 21 — Seeing what Poko uses

## Goal

Show how much each answer used, and how close the user is to their plan's limits, now that routines, the question queue, and long resumed conversations make Poko do more on its own.

## What the engines report (checked 2026-10-12: Codex 0.161.0, Claude Code 2.1.296)

- **Codex App Server:**
  - `thread/tokenUsage/updated { tokenUsage: { last, total } }` per turn. Each breakdown has input, cached input, cache-write input, output, and reasoning-output tokens;
  - `account/rateLimits/read` (and `account/rateLimits/updated`) report the plan's windows: `primary` and `secondary`, each with `usedPercent`, `windowDurationMins`, and `resetsAt`.
- **Claude Code** (stream-json):
  - the `result` message carries `usage` (input, output, and cache read and creation tokens) and `total_cost_usd`. That cost is the API price of the turn, not what a subscription is charged;
  - a `rate_limit_event` carries `rate_limit_info` with `status`, `rateLimitType` (for example `five_hour`), and `resetsAt`.

## What the user experiences

- **작업 page:** each finished task shows its tokens ("입력 12.3k · 출력 850"), plus, on Claude Code, "API 기준 약 $0.08".
- **설정 → 사용량:**
  - this month's tokens per engine;
  - the Claude Code API-equivalent cost this month, labelled as an estimate that a subscription isn't billed by;
  - the latest plan limits each engine reported, such as "Codex 5시간 한도 37% 사용 · 15:20에 초기화" or "Claude Code 5시간 한도 정상 · 17:00에 초기화", with when it was last seen.
- Nothing is sent anywhere. These are the numbers the engines already report to Poko.

## Design

- **One shape for both engines** (`tasks.usage`, nullable JSON, written when a task ends):
  - `{ engine, inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, costUsd? }`;
  - `inputTokens` is **all** input, with cached reads and cache writes included. Codex's `inputTokens` already includes cached input. Claude's `input_tokens` doesn't, so Poko adds `cache_read_input_tokens` and `cache_creation_input_tokens`;
  - cached reads and cache writes are also kept on their own, so both engines read the same.
- **Codex tokens for one task:**
  - `thread/tokenUsage/updated` carries `last` (the latest model request) and `total` (the whole thread, including earlier turns of a resumed conversation);
  - the task's usage is the last `total` seen minus the thread's total before the turn, which is the first update's `total` minus its `last`. That counts every request in the turn and no earlier turn;
  - a cancelled or failed turn records what was seen up to then, since it used tokens too.
- **Claude Code tokens:** `result.usage` and `total_cost_usd` (an interrupted run still sends its `result`).
- **Screen tasks:** each step of 대신 해 줘 is its own engine run. The steps report usage under the parent task, and it is summed.
- **Plan limits:**
  - kept per engine in settings (`usageLimits:codex`, `usageLimits:claude`) as `{ windows: { [key]: { label, usedPercent?, status?, resetsAt } }, seenAt }`;
  - windows are **merged by key**: Codex `primary` and `secondary`, and Claude's `rateLimitType` such as `five_hour` or `seven_day`. A report about one window never erases another;
  - `resetsAt` arrives in Unix seconds from both engines and is stored as ISO time;
  - **Codex:** `account/rateLimits/updated` when sent during the turn, plus one `account/rateLimits/read` sent right after `initialize`, alongside the thread start. It has a short timeout (3 s), and its reply is used only if it arrives before the task ends. It never delays the answer or keeps the task busy;
  - **Claude Code:** every `rate_limit_event` in the run.
- **Getting the numbers out:**
  - providers report through `RunOptions.onUsage` and `onLimits` (like `onSession` in Phase 20), so `AgentEvent` doesn't change;
  - main records usage when the task ends, then sends `task:usage { taskId, usage }` to the window, so the 작업 page updates without a reload;
  - bootstrap includes each task's usage.
- **Totals:**
  - this month is the **local** month, compared by `completedAt` against local month boundaries converted to UTC, so a task finishing just after midnight on the 1st counts in the new month;
  - 모든 데이터 삭제 clears the tasks and also the `usageLimits:*` settings.
- **Renderer:** 설정 asks main for this month's totals and the limits through one IPC, `usage:summary`.

## Milestones (one PR each)

1. **Recording:**
   - the migration and the normalized shape;
   - `onUsage` and `onLimits` in both providers, including screen steps;
   - storing usage at the task's end (cancelled too), and merging limits;
   - `task:usage`, `usage:summary`, the local-month totals, and delete-all.

   Real check: a task on each engine records tokens, and limits appear.
2. **Showing:** the 작업 page line and 설정 → 사용량.

## Explicitly deferred

- Warnings or pausing routines near a limit (to decide after seeing real numbers).
- Per-conversation totals and charts.

## Status

- **Milestone 1 (recording) is done.** Real check (test profile, one question on each engine):
  - **Codex:** 60,685 input tokens (40,064 cached) and 109 output tokens. Limits: 5시간 한도 20% and 1주 한도 4%, with reset times;
  - **Claude Code:** 21,840 input tokens (20,250 cached, 1,524 cache writes), 248 output tokens, and about $0.049 at API prices. Limits: 5시간 한도 "allowed", with its reset time;
  - `task:usage` reached the window for both, and `usage:summary` returned the month and the limits.

