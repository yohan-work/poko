import { ipcMain, powerMonitor } from "electron";
import type { RoutineRecord } from "../database/Database";
import { resolveWorkspaceDirectory } from "../agent/workspace";
import { RoutineRunner, type StartOutcome } from "../routines/RoutineRunner";
import { nextRun } from "../routines/schedule";
import {
  IPC_CHANNELS,
  type Routine,
  type RoutineInput,
  readRoutineSchedule,
  type TaskStartedNotice,
} from "../shared";
import { ctx, isTrustedRenderer } from "./context";
import { hasWaiting, kickQueue } from "./queue";

/** Running routine tasks, so their end is written to the routine's last result. */
export const routineTasks = new Map<string, string>();
/**
 * Routine runs the user stopped, recorded as skipped rather than failed, with why: to ask
 * something (the banner), or stopped in a window that took the run over.
 */
const yieldedTasks = new Map<string, string>();

/** Marks a routine run the user is stopping, so its end is recorded as skipped. */
export function markRoutineStopped(taskId: string, why: string): boolean {
  if (!routineTasks.has(taskId)) return false;
  yieldedTasks.set(taskId, why);
  return true;
}

/** The title of the routine a running task belongs to, if it is one. */
export function routineTitleFor(taskId: string): string | undefined {
  const routineId = routineTasks.get(taskId);
  return routineId ? (ctx.database?.getRoutine(routineId)?.title ?? undefined) : undefined;
}

/**
 * Starts one routine run in the routine's own folder and conversation, always read-only. It
 * shares the message path's guards: nothing starts while data is being deleted or another task
 * runs or starts, and the folder is checked before anything is recorded.
 */
export async function startRoutineTask(
  routine: RoutineRecord,
): Promise<StartOutcome & { taskId?: string }> {
  if (!ctx.agentCore || !ctx.database || ctx.deletingData) return { busy: true };
  ctx.startingTasks += 1;
  try {
    // This start is counted, so another start makes it more than one. Questions the user left
    // waiting go first.
    const busy = () =>
      ctx.deletingData ||
      ctx.agentCore?.hasActiveTasks ||
      ctx.screenRun ||
      ctx.startingTasks > 1 ||
      hasWaiting();
    if (busy()) return { busy: true };
    let cwd: string;
    try {
      cwd = await resolveWorkspaceDirectory(routine.workspacePath);
    } catch {
      return { skipped: "루틴의 폴더를 찾지 못해서 건너뛰었어." };
    }
    if (busy()) return { busy: true };
    const conversationId = ctx.database.ensureRoutineConversation(routine.id, cwd);
    // Recorded in the routine's conversation, which doesn't become the window's active one.
    const taskId = ctx.database.createTask(routine.prompt, cwd, conversationId);
    const conversation = ctx.database.getTaskConversation(taskId);
    if (!conversation) throw new Error("The routine's conversation was not recorded.");
    routineTasks.set(taskId, routine.id);
    // The main window learns about the run before it starts, as with the quick panel.
    const notice: TaskStartedNotice = {
      taskId,
      title: routine.prompt,
      conversation,
      routineTitle: routine.title,
    };
    if (ctx.mainWindow && !ctx.mainWindow.isDestroyed())
      ctx.mainWindow.webContents.send(IPC_CHANNELS.taskStarted, notice);
    try {
      ctx.agentCore.startTask({
        prompt: routine.prompt,
        cwd,
        taskId,
        context: ctx.database.getTaskContext(taskId),
        editsEnabled: false,
        routine: true,
      });
    } catch (error) {
      console.error("Could not start a routine.", error);
      routineTasks.delete(taskId);
      ctx.database.recordTaskEvent(
        taskId,
        "error",
        "작업을 시작하지 못했어.",
        "작업을 시작하지 못했어.",
      );
      if (ctx.mainWindow && !ctx.mainWindow.isDestroyed())
        ctx.mainWindow.webContents.send(IPC_CHANNELS.taskEvent, {
          taskId,
          event: { type: "error", error: "작업을 시작하지 못했어." },
        });
      return { skipped: "루틴을 시작하지 못했어." };
    }
    return { started: true, taskId };
  } finally {
    ctx.startingTasks -= 1;
    kickQueue();
  }
}

/** Writes a finished routine run's result; called for every task event. */
export function recordRoutineEnd(taskId: string, type: string, error?: string): void {
  const routineId = routineTasks.get(taskId);
  if (!routineId || !["completed", "error", "cancelled"].includes(type)) return;
  routineTasks.delete(taskId);
  const stoppedWhy = yieldedTasks.get(taskId);
  yieldedTasks.delete(taskId);
  try {
    // Stopped by the user: skipped, whether the engine ended it as cancelled or with an error.
    if (stoppedWhy && type !== "completed") {
      ctx.database?.recordRoutineRun(routineId, {
        status: "skipped",
        message: stoppedWhy,
        at: new Date().toISOString(),
      });
      return;
    }
    ctx.database?.recordRoutineRun(routineId, {
      status: type === "completed" ? "completed" : "failed",
      ...(type === "completed"
        ? {}
        : {
            message: type === "cancelled" ? "요청을 멈췄어." : (error ?? "작업을 마치지 못했어."),
          }),
      at: new Date().toISOString(),
    });
  } catch (failure) {
    console.error("Could not record a routine result.", failure);
  }
}

function toRoutine(record: RoutineRecord, now: Date): Routine {
  const next = record.enabled
    ? nextRun(record.schedule, new Date(record.scheduleChangedAt), now)
    : null;
  return {
    id: record.id,
    title: record.title,
    prompt: record.prompt,
    schedule: record.schedule,
    workspacePath: record.workspacePath,
    conversationId: record.conversationId,
    enabled: record.enabled,
    lastRunAt: record.lastRunAt,
    lastResult: record.lastResult,
    nextRunAt: next ? next.toISOString() : null,
  };
}

/** A routine from the page, checked again here; null when any part of it is off. */
export function readRoutineInput(raw: unknown): RoutineInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const title = typeof value.title === "string" ? value.title.replace(/\s+/g, " ").trim() : "";
  const prompt = typeof value.prompt === "string" ? value.prompt.trim() : "";
  const schedule = readRoutineSchedule(value.schedule);
  if (!title || title.length > 60 || !prompt || prompt.length > 4000 || !schedule) return null;
  if (typeof value.enabled !== "boolean") return null;
  if (value.id !== undefined && (typeof value.id !== "string" || value.id.length > 100))
    return null;
  return {
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    title,
    prompt,
    schedule,
    enabled: value.enabled,
  };
}

export function registerRoutineHandlers(): void {
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (!isTrustedRenderer(event) || !ctx.database) throw new Error("Unknown sender.");
    return ctx.database;
  };

  ipcMain.handle(IPC_CHANNELS.routinesList, (event) => {
    const now = new Date();
    return trusted(event)
      .listRoutines()
      .map((record) => toRoutine(record, now));
  });

  ipcMain.handle(IPC_CHANNELS.routinesSave, (event, raw: unknown) => {
    const database = trusted(event);
    const input = readRoutineInput(raw);
    if (!input) return { error: "루틴 내용을 다시 확인해 줘." };
    // A new routine runs in the folder selected now; the page never names a path.
    const workspacePath = input.id ? undefined : database.getWorkspace();
    if (!input.id && !workspacePath) return { error: "먼저 작업할 폴더를 선택해 줘." };
    try {
      return {
        routine: toRoutine(
          database.saveRoutine({ ...input, workspacePath: workspacePath ?? undefined }),
          new Date(),
        ),
      };
    } catch {
      return { error: "루틴을 저장하지 못했어. 다시 시도해 줘." };
    }
  });

  ipcMain.handle(IPC_CHANNELS.routinesDelete, (event, id: unknown) => {
    const database = trusted(event);
    return typeof id === "string" && database.deleteRoutine(id);
  });

  // 지금 실행: a run the user asked for, outside the schedule.
  ipcMain.handle(IPC_CHANNELS.routinesRun, async (event, id: unknown) => {
    const database = trusted(event);
    const routine = typeof id === "string" ? database.getRoutine(id) : null;
    if (!routine) return { error: "루틴을 찾을 수 없어." };
    const outcome = await startRoutineTask(routine);
    if ("busy" in outcome)
      return { error: "포코가 다른 작업을 하고 있어. 끝난 뒤에 다시 실행해 줘." };
    const at = new Date().toISOString();
    if ("skipped" in outcome) {
      database.recordRoutineRun(routine.id, { status: "skipped", message: outcome.skipped, at });
      return { error: outcome.skipped };
    }
    database.recordRoutineRun(routine.id, { status: "running", at }, { ran: true });
    return { ok: true };
  });
}

/**
 * Gives routine conversations from before Phase 16 (no task in a folder yet) their routine's
 * folder, resolved, so a follow-up there is held to that folder from the start.
 */
async function labelRoutineConversations(): Promise<void> {
  const database = ctx.database;
  if (!database) return;
  for (const routine of database.listRoutines()) {
    if (!routine.conversationId || database.getConversation(routine.conversationId)?.workspacePath)
      continue;
    const folder = await resolveWorkspaceDirectory(routine.workspacePath).catch(() => null);
    if (folder) database.ensureRoutineConversation(routine.id, folder);
  }
}

/**
 * 멈추고 지금 묻기: cancels a running routine run (only a routine's, never the user's own task)
 * and resolves once Poko is free, so the question can start right after.
 */
export function registerRoutineYield(): void {
  ipcMain.handle(IPC_CHANNELS.routinesYield, async (event, taskId: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.agentCore) throw new Error("Unknown sender.");
    if (typeof taskId !== "string") return false;
    const core = ctx.agentCore;
    const running = () => core.activeTaskIds.includes(taskId);
    // Already over (it just finished on its own): nothing left to stop.
    if (!running()) return true;
    if (!markRoutineStopped(taskId, "질문을 먼저 하려고 멈췄어.")) return false;
    core.cancelTask(taskId);
    // The run stops within moments; never wait forever for an engine that hangs.
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      core.whenIdle(),
      new Promise((done) => {
        timer = setTimeout(done, 10_000);
      }),
    ]);
    clearTimeout(timer);
    // Success is this run being over, whatever else may have started meanwhile.
    return !running();
  });
}

/** Checks routines every minute, right away, and when the Mac wakes or unlocks. */
export function startRoutineScheduler(): () => void {
  void labelRoutineConversations().catch((error) =>
    console.error("Could not label routine conversations.", error),
  );
  const runner = new RoutineRunner({
    list: () => ctx.database?.listRoutines() ?? [],
    start: startRoutineTask,
    record: (id, result, options) => ctx.database?.recordRoutineRun(id, result, options),
    now: () => new Date(),
  });
  const check = () =>
    void runner.tick().catch((error) => console.error("Could not check routines.", error));
  const timer = setInterval(check, 60 * 1000);
  powerMonitor.on("resume", check);
  powerMonitor.on("unlock-screen", check);
  check();
  return () => {
    clearInterval(timer);
    powerMonitor.off("resume", check);
    powerMonitor.off("unlock-screen", check);
  };
}
