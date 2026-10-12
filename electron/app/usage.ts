import { ipcMain } from "electron";
import {
  type EngineSession,
  type EngineId,
  IPC_CHANNELS,
  type TaskUsage,
  type UsageLimitWindow,
  type UsageSummary,
} from "../shared";
import { ctx, isTrustedRenderer } from "./context";
import { resumedSessionOf } from "./sessions";

/**
 * Usage (Phase 21): each engine run adds what it used to its task, and plan limits are merged
 * per engine. See docs/phases/phase-21.md. Recording never gets in the way of a task.
 */

/** A Claude Code session's cost so far, as last reported per task, for the session record. */
const sessionCosts = new Map<string, number>();

/** The session cost a task's run reported, once (Phase 20 keeps it with the session). */
export function takeSessionCost(taskId: string): number | undefined {
  const cost = sessionCosts.get(taskId);
  sessionCosts.delete(taskId);
  return cost;
}

export function addTaskUsage(
  taskId: string,
  usage: TaskUsage,
  extra: { sessionCostUsd?: number } = {},
): void {
  try {
    if (extra.sessionCostUsd !== undefined) {
      // The run's share: the session's total now minus what it had cost before this run.
      const conversation = ctx.database?.getTaskConversation(taskId);
      const stored = conversation ? ctx.database?.getEngineSession(conversation.id) : null;
      const before = planCost(taskId, stored ?? null);
      usage = { ...usage, costUsd: Math.max(0, extra.sessionCostUsd - before) };
      sessionCosts.set(taskId, extra.sessionCostUsd);
    }
    const total = ctx.database?.addTaskUsage(taskId, usage);
    if (!total) return;
    const window = ctx.mainWindow;
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send(IPC_CHANNELS.taskUsage, { taskId, usage: total });
  } catch (error) {
    console.error("Could not record a task's usage.", error);
  }
}

/** What the session this task continued had cost before it (0 for a new session). */
function planCost(taskId: string, stored: EngineSession | null): number {
  const resumed = resumedSessionOf(taskId);
  return resumed && stored?.id === resumed && typeof stored.costUsd === "number"
    ? stored.costUsd
    : 0;
}

export function recordLimits(engine: EngineId, windows: Record<string, UsageLimitWindow>): void {
  try {
    ctx.database?.mergeUsageLimits(engine, windows);
  } catch (error) {
    console.error("Could not record plan limits.", error);
  }
}

/** This local month's bounds as UTC instants, so a task just after midnight counts right. */
export function localMonth(now = new Date()): { from: string; to: string } {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function registerUsageHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.usageSummary, (event): UsageSummary => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer asked for usage.");
    const { from, to } = localMonth();
    const limits: UsageSummary["limits"] = {};
    for (const engine of ["codex", "claude"] as const) {
      const seen = ctx.database.getUsageLimits(engine);
      if (seen) limits[engine] = seen;
    }
    return { month: ctx.database.usageBetween(from, to), limits };
  });
}
