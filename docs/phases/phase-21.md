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

- **Storage:**
  - `tasks.usage` (nullable JSON) holds `{ engine, inputTokens, cachedInputTokens, outputTokens, costUsd? }`, written when a task ends;
  - the latest limits per engine are kept in settings, under `usageLimits:codex` and `usageLimits:claude`, as `{ windows: [{ label, usedPercent?, status?, resetsAt }], seenAt }`.
- **Getting the numbers:** providers report usage through a new `RunOptions.onUsage` (like `onSession` in Phase 20), so `AgentEvent` and the renderer's event handling don't change.
  - **Codex:** the last `thread/tokenUsage/updated` of the turn gives the task's tokens. Limits come from `account/rateLimits/updated` when sent, and otherwise from one `account/rateLimits/read` at the end of a task on the same connection, which is best effort and never delays the answer;
  - **Claude Code:** `result.usage` and `total_cost_usd`, and the last `rate_limit_event`.
- **Totals:** this month's totals are summed from `tasks.usage` in local time. 모든 데이터 삭제 clears them with the tasks.
- **Renderer:** the 작업 page gets usage with each task, and 설정 asks main for the month's totals and the limits through one IPC call, `usage:summary`.

## Milestones (one PR each)

1. **Recording:**
   - the migration;
   - `onUsage` in both providers;
   - storing task usage and the latest limits;
   - `usage:summary`.

   Real check: a task on each engine records tokens, and limits appear.
2. **Showing:** the 작업 page line and 설정 → 사용량.

## Explicitly deferred

- Warnings or pausing routines near a limit (to decide after seeing real numbers).
- Per-conversation totals and charts.
