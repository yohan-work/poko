import { createHash } from "node:crypto";
import type { SessionReport } from "../agent/AgentProvider";
import type { TaskContext } from "../agent/context";
import type { EngineId, EngineSession } from "../shared";
import { deleteClaudeSession } from "../providers/claude/claudeSessions";
import { ctx } from "./context";
import { takeSessionCost } from "./usage";

/**
 * Engine sessions per conversation (Phase 20): which one a task continues, and what is kept
 * once it ends. See docs/phases/phase-20.md.
 */

/** What was decided for a running task, so its end is recorded against the same facts. */
const planned = new Map<string, { engine: EngineId; memoryHashes: string[]; resumeId?: string }>();
/** The session each running task reported. */
const reports = new Map<string, SessionReport>();

/** A short hash of a memory as sent (type and text). */
export function memoryHash(memory: { type: string; content: string }): string {
  return createHash("sha256")
    .update(`${memory.type}\n${memory.content}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * How a conversation task uses an engine session: continue the stored one when it is still
 * usable, otherwise start one to keep. Usable means the same engine, no failed or cancelled
 * task in it, every memory it was sent still sent now (a memory deleted, changed, or turned
 * off is never seen again through old turns), and every answer it missed fits the catch-up.
 */
export function planSession(
  conversationId: string,
  taskId: string,
): { engine: EngineId; resumeId?: string; catchUp: TaskContext["history"] } | undefined {
  try {
    return plan(conversationId, taskId);
  } catch (error) {
    // Never in the way of the question: it is then answered fresh, as before Phase 20.
    console.error("Could not look up the conversation's engine session.", error);
    planned.delete(taskId);
    return undefined;
  }
}

function plan(
  conversationId: string,
  taskId: string,
): { engine: EngineId; resumeId?: string; catchUp: TaskContext["history"] } | undefined {
  const database = ctx.database;
  if (!database) return undefined;
  const engine = database.getSettings().engine;
  const sent = database.getTaskContext(taskId).memories.map(memoryHash);
  const current = new Set(sent);
  const stored = database.getEngineSession(conversationId);
  const missed =
    stored && stored.engine === engine && !stored.dirty
      ? database.exchangesAfter(conversationId, stored.lastTaskId, taskId)
      : null;
  const usable =
    stored &&
    missed &&
    missed.missed === 0 &&
    stored.memoryHashes.every((hash) => current.has(hash));
  planned.set(taskId, {
    engine,
    memoryHashes: usable ? [...new Set([...stored.memoryHashes, ...sent])] : sent,
    ...(usable ? { resumeId: stored.id } : {}),
  });
  if (!usable) return { engine, catchUp: [] };
  return { engine, resumeId: stored.id, catchUp: missed.history };
}

const claudeEnv = (): NodeJS.ProcessEnv => ctx.claudeSetup?.runtime().environment ?? process.env;

/** A task that didn't start: nothing will be reported or finished for it. */
export function forgetPlan(taskId: string): void {
  planned.delete(taskId);
  reports.delete(taskId);
}

/** The stored session this task continued, if it continued one. */
export function resumedSessionOf(taskId: string): string | undefined {
  const report = reports.get(taskId);
  return report?.resumed ? report.id : undefined;
}

export function recordSessionReport(taskId: string, report: SessionReport): void {
  if (planned.has(taskId)) reports.set(taskId, report);
}

/**
 * On a task's end: the session it ran in becomes the conversation's (marked unusable after a
 * failed or cancelled task, whose turn must never become context), and a session it replaced
 * is deleted in the engine. A one-off answer (the stored session was out of reach) changes
 * nothing; the next resume catches up on it.
 */
export function finishSession(taskId: string, type: string): void {
  try {
    finish(taskId, type);
  } catch (error) {
    // Never in the way of the answer: the next question then starts fresh.
    console.error("Could not record the conversation's engine session.", error);
  }
}

function finish(taskId: string, type: string): void {
  const plan = planned.get(taskId);
  const report = reports.get(taskId);
  planned.delete(taskId);
  reports.delete(taskId);
  const database = ctx.database;
  if (!plan || !database) return;
  if (!report) {
    // Claude Code failed before it got going in the stored session: don't try that session
    // again as is, or every question in this conversation could fail the same way. (A cancel,
    // or Codex out of reach, leaves it as it is: the failed turn never entered the session.)
    if (plan.resumeId && plan.engine === "claude" && type === "error") {
      const conversation = database.getTaskConversation(taskId);
      const stored = conversation ? database.getEngineSession(conversation.id) : null;
      if (conversation && stored?.id === plan.resumeId)
        database.setEngineSession(conversation.id, { ...stored, dirty: true });
    }
    return;
  }
  const conversation = database.getTaskConversation(taskId);
  if (!conversation) {
    if (report.kept && !report.resumed)
      deleteEngineSessions([
        { engine: plan.engine, id: report.id, cwd: database.getTaskWorkspace(taskId) ?? undefined },
      ]);
    return;
  }
  // A one-off answer (the stored session out of reach) changes nothing.
  if (!report.kept) return;
  const stored = database.getEngineSession(conversation.id);
  const cwd = database.getTaskWorkspace(taskId);
  const sessionCost = takeSessionCost(taskId);
  const session: EngineSession = {
    engine: plan.engine,
    id: report.id,
    lastTaskId: taskId,
    memoryHashes: plan.memoryHashes,
    dirty: type !== "completed",
    // Claude Code: the folder its transcript is kept under, and its cost so far.
    ...(plan.engine === "claude" && cwd ? { cwd } : {}),
    ...(plan.engine === "claude" && sessionCost !== undefined ? { costUsd: sessionCost } : {}),
  };
  database.setEngineSession(conversation.id, session);
  if (stored && stored.id !== report.id) deleteEngineSessions([stored]);
}

/** Deletes sessions in their engines; best effort, never awaited by a delete in Poko. */
export function deleteEngineSessions(
  sessions: Array<Pick<EngineSession, "engine" | "id" | "cwd">>,
): void {
  for (const session of sessions) {
    if (session.engine !== "claude" || !session.cwd) continue;
    try {
      deleteClaudeSession(claudeEnv(), session.cwd, session.id);
    } catch (error) {
      console.error("Could not delete a Claude Code session.", error);
    }
  }
  const codex = sessions
    .filter((session) => session.engine === "codex")
    .map((session) => session.id);
  if (codex.length > 0 && ctx.screenProvider)
    void ctx.screenProvider
      .deleteThreads(codex)
      .catch((error) => console.error("Could not delete Codex threads.", error));
}
