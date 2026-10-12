import type { SessionReport } from "../agent/AgentProvider";
import type { TaskContext } from "../agent/context";
import type { EngineId, EngineSession } from "../shared";
import { ctx } from "./context";

/**
 * Engine sessions per conversation (Phase 20): which one a task continues, and what is kept
 * once it ends. See docs/phases/phase-20.md.
 */

/** What was decided for a running task, so its end is recorded against the same facts. */
const planned = new Map<string, { engine: EngineId; memoryVersion: number }>();
/** The session each running task reported. */
const reports = new Map<string, SessionReport>();

/**
 * How a conversation task uses an engine session: continue the stored one when it is still
 * usable (same engine, memories unchanged, no failed or cancelled task in it), otherwise start
 * one to keep. Claude Code keeps no session yet (milestone 2), so it gets none.
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
  if (engine !== "codex") return undefined;
  const memoryVersion = database.memoryVersion();
  planned.set(taskId, { engine, memoryVersion });
  const stored = database.getEngineSession(conversationId);
  const usable =
    stored && stored.engine === engine && !stored.dirty && stored.memoryVersion === memoryVersion;
  if (!usable) return { engine, catchUp: [] };
  return {
    engine,
    resumeId: stored.id,
    catchUp: database.exchangesAfter(conversationId, stored.lastTaskId, taskId),
  };
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
  const plan = planned.get(taskId);
  const report = reports.get(taskId);
  planned.delete(taskId);
  reports.delete(taskId);
  const database = ctx.database;
  if (!plan || !report || !database) return;
  const conversation = database.getTaskConversation(taskId);
  if (!conversation) {
    if (report.kept && !report.resumed)
      deleteEngineSessions([{ engine: plan.engine, id: report.id }]);
    return;
  }
  const stored = database.getEngineSession(conversation.id);
  if (!report.kept) {
    if (report.forgetPrevious && stored) {
      database.setEngineSession(conversation.id, null);
      deleteEngineSessions([stored]);
    }
    return;
  }
  const session: EngineSession = {
    engine: plan.engine,
    id: report.id,
    lastTaskId: taskId,
    memoryVersion: plan.memoryVersion,
    dirty: type !== "completed",
  };
  database.setEngineSession(conversation.id, session);
  if (stored && stored.id !== report.id) deleteEngineSessions([stored]);
}

/** Deletes sessions in their engines; best effort, never awaited by a delete in Poko. */
export function deleteEngineSessions(sessions: Array<Pick<EngineSession, "engine" | "id">>): void {
  const codex = sessions
    .filter((session) => session.engine === "codex")
    .map((session) => session.id);
  if (codex.length > 0 && ctx.screenProvider)
    void ctx.screenProvider
      .deleteThreads(codex)
      .catch((error) => console.error("Could not delete Codex threads.", error));
}
