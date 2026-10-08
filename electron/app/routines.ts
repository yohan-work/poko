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

/** Running routine tasks, so their end is written to the routine's last result. */
export const routineTasks = new Map<string, string>();

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
    // This start is counted, so another start makes it more than one.
    const busy = () =>
      ctx.deletingData || ctx.agentCore?.hasActiveTasks || ctx.screenRun || ctx.startingTasks > 1;
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
    const notice: TaskStartedNotice = { taskId, title: routine.prompt, conversation };
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
  }
}

/** Writes a finished routine run's result; called for every task event. */
export function recordRoutineEnd(taskId: string, type: string, error?: string): void {
  const routineId = routineTasks.get(taskId);
  if (!routineId || !["completed", "error", "cancelled"].includes(type)) return;
  routineTasks.delete(taskId);
  try {
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

/** Checks routines every minute, right away, and when the Mac wakes or unlocks. */
export function startRoutineScheduler(): () => void {
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
