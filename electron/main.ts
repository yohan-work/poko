import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  IPC_CHANNELS,
  type ApprovalChoice,
  type ApprovalOutcome,
  type ApprovalRequest,
  type MemoryInput,
  type TaskEventPayload,
  type WorkspaceInfo,
} from "./shared";
import { AgentCore } from "./agent/AgentCore";
import { resolveWorkspaceDirectory } from "./agent/workspace";
import { resolveCodexExecutable } from "./providers/codex/CodexProvider";
import { CodexAppServerProvider } from "./providers/codex/CodexAppServerProvider";
import { PokoDatabase } from "./database/Database";
import { ScreenService } from "./screen/ScreenService";
import { HelperError } from "./screen/axHelper";

let mainWindow: BrowserWindow | null = null;
let agentCore: AgentCore | null = null;
let database: PokoDatabase | null = null;
let screenService: ScreenService | null = null;
/** Temp folders (screenshot and empty work folder) of running screen tasks. */
const screenTempDirs = new Map<string, string>();

const screenErrors: Record<string, string> = {
  window_not_found: "그 창을 더 이상 찾을 수 없어. 다시 골라 줘.",
  window_not_matched: "고른 창을 정확히 찾지 못했어. 창을 앞으로 가져온 뒤 다시 시도해 줘.",
  window_ambiguous:
    "같은 모양의 창이 여러 개라 하나를 고를 수 없어. 다른 창을 닫고 다시 시도해 줘.",
  no_accessibility: "손쉬운 사용 권한이 필요해.",
  capture_failed: "화면 기록 권한이 필요해.",
  capture_mismatch: "창을 정확히 캡처하지 못했어. 창 크기를 바꾸지 말고 다시 시도해 줘.",
};

function workspaceInfo(workspacePath: string | null): WorkspaceInfo | null {
  if (!workspacePath) return null;
  return { path: workspacePath, name: basename(workspacePath) };
}

function isTrustedRenderer(event: IpcMainInvokeEvent): boolean {
  return Boolean(
    mainWindow &&
      !mainWindow.isDestroyed() &&
      event.sender === mainWindow.webContents &&
      event.senderFrame === mainWindow.webContents.mainFrame,
  );
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.workspaceGet, async (event) => {
    if (!isTrustedRenderer(event)) {
      throw new Error("Unknown renderer requested the workspace.");
    }

    return workspaceInfo(database?.getWorkspace() ?? null);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceSelect, async (event) => {
    if (!isTrustedRenderer(event) || !mainWindow) {
      throw new Error("Unknown renderer requested workspace selection.");
    }

    const parentWindow = mainWindow;
    const currentPath = database?.getWorkspace() ?? null;
    const selection = await dialog.showOpenDialog(parentWindow, {
      title: "작업할 폴더 선택",
      defaultPath: currentPath ?? undefined,
      properties: ["openDirectory"],
    });

    if (selection.canceled || selection.filePaths.length === 0) return null;

    const [selectedPath] = selection.filePaths;
    database?.setWorkspace(selectedPath);
    return workspaceInfo(selectedPath);
  });

  ipcMain.handle(IPC_CHANNELS.taskStart, async (event, rawMessage: unknown) => {
    if (!isTrustedRenderer(event) || !agentCore) {
      throw new Error("Unknown renderer requested a task.");
    }
    if (typeof rawMessage !== "string" || rawMessage.trim().length === 0) {
      throw new TypeError("A non-empty message is required.");
    }
    if (rawMessage.length > 10_000) {
      throw new TypeError("The request is too long.");
    }

    const workspacePath = database?.getWorkspace() ?? null;
    const cwd = await resolveWorkspaceDirectory(workspacePath);
    const taskId = database?.createTask(rawMessage.trim(), cwd);
    if (!taskId) throw new Error("Local storage is unavailable.");
    try {
      const context = database?.getTaskContext(taskId);
      agentCore.startTask({ prompt: rawMessage.trim(), cwd, taskId, context });
    } catch (error) {
      database?.recordTaskEvent(
        taskId,
        "error",
        "작업을 시작하지 못했어.",
        "작업을 시작하지 못했어.",
      );
      throw error;
    }
    return { taskId };
  });

  ipcMain.handle(IPC_CHANNELS.taskCancel, (event, rawTaskId: unknown) => {
    if (!isTrustedRenderer(event) || !agentCore) {
      throw new Error("Unknown renderer requested task cancellation.");
    }
    if (typeof rawTaskId !== "string" || rawTaskId.length > 100) {
      throw new TypeError("A valid task id is required.");
    }
    return agentCore.cancelTask(rawTaskId);
  });

  ipcMain.handle(IPC_CHANNELS.approvalRespond, (event, rawRequest: unknown) => {
    if (!isTrustedRenderer(event) || !database || !agentCore)
      throw new Error("Unknown renderer requested an approval decision.");
    if (typeof rawRequest !== "object" || rawRequest === null)
      throw new TypeError("Invalid approval response.");
    const request = rawRequest as { taskId?: unknown; requestId?: unknown; choice?: unknown };
    if (
      typeof request.taskId !== "string" ||
      typeof request.requestId !== "string" ||
      request.taskId.length > 100 ||
      request.requestId.length > 200 ||
      (request.choice !== "approve" && request.choice !== "decline")
    )
      throw new TypeError("Invalid approval response.");
    if (!agentCore.hasPendingApproval(request.taskId, request.requestId)) return "stale";
    // Decide before recording, so the audit row always matches what Codex receives.
    const unsafe =
      request.choice === "approve" && !agentCore.canStillApprove(request.taskId, request.requestId);
    const choice: ApprovalChoice = unsafe ? "decline" : (request.choice as ApprovalChoice);
    if (!database.resolveApproval(request.taskId, request.requestId, choice)) return "stale";
    if (!agentCore.respondToApproval(request.taskId, request.requestId, choice)) {
      console.error("The decision was recorded but could not be sent to Codex.");
      return "stale";
    }
    const outcome: ApprovalOutcome = unsafe ? "declined_unsafe" : "applied";
    return outcome;
  });

  ipcMain.handle(IPC_CHANNELS.screenStatus, (event) => {
    if (!isTrustedRenderer(event) || !database || !screenService)
      throw new Error("Unknown renderer requested screen status.");
    return screenService.status(database.isScreenNoticeAccepted());
  });
  ipcMain.handle(IPC_CHANNELS.screenOpenSettings, (event, kind: unknown) => {
    if (!isTrustedRenderer(event) || !screenService)
      throw new Error("Unknown renderer requested settings.");
    if (kind !== "screen" && kind !== "accessibility") throw new TypeError("Invalid settings.");
    return screenService.openSettings(kind);
  });
  ipcMain.handle(IPC_CHANNELS.screenAcceptNotice, (event) => {
    if (!isTrustedRenderer(event) || !database)
      throw new Error("Unknown renderer accepted the screen notice.");
    database.acceptScreenNotice();
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.screenListWindows, (event) => {
    if (!isTrustedRenderer(event) || !screenService)
      throw new Error("Unknown renderer requested windows.");
    return screenService.listWindows();
  });
  ipcMain.handle(IPC_CHANNELS.screenLook, async (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !database || !agentCore || !screenService)
      throw new Error("Unknown renderer requested a screen look.");
    const request = (typeof raw === "object" && raw !== null ? raw : {}) as {
      windowId?: unknown;
      question?: unknown;
    };
    if (
      !Number.isSafeInteger(request.windowId) ||
      typeof request.question !== "string" ||
      request.question.length > 2000
    )
      throw new TypeError("Invalid screen request.");
    if (!database.isScreenNoticeAccepted()) return { error: "먼저 화면 보기 안내를 확인해 줘." };
    if (agentCore.hasActiveTasks)
      return { error: "포코가 이미 다른 작업을 하고 있어. 잠시만 기다려 줘." };

    let look: Awaited<ReturnType<ScreenService["prepareLook"]>>;
    try {
      look = await screenService.prepareLook(request.windowId as number, request.question);
    } catch (error) {
      const code = error instanceof HelperError ? error.code : "";
      return {
        error: screenErrors[code] ?? "화면을 가져오지 못했어. 권한을 확인하고 다시 시도해 줘.",
      };
    }
    const question = request.question.trim() || "이 화면을 설명해 줘.";
    const taskId = database.createTask(
      `🖥️ ${look.app} 화면 보기: ${question}`,
      `screen:${look.app}`,
    );
    screenTempDirs.set(taskId, look.tempDir);
    try {
      agentCore.startTask({
        prompt: look.prompt,
        cwd: look.workDir,
        taskId,
        screen: { images: [look.imagePath] },
      });
    } catch {
      screenTempDirs.delete(taskId);
      void screenService.cleanup(look.tempDir);
      database.recordTaskEvent(
        taskId,
        "error",
        "작업을 시작하지 못했어.",
        "작업을 시작하지 못했어.",
      );
      return { error: "작업을 시작하지 못했어. 잠시 뒤 다시 시도해 줘." };
    }
    return { taskId };
  });

  ipcMain.handle(IPC_CHANNELS.appBootstrap, (event) => {
    if (!isTrustedRenderer(event) || !database)
      throw new Error("Unknown renderer requested app data.");
    const { workspacePath, ...data } = database.getBootstrapData();
    return { ...data, workspace: workspaceInfo(workspacePath) };
  });
  ipcMain.handle(IPC_CHANNELS.memoryList, (event) => {
    if (!isTrustedRenderer(event) || !database)
      throw new Error("Unknown renderer requested memories.");
    return database.listMemories();
  });
  ipcMain.handle(IPC_CHANNELS.memorySearch, (event, rawQuery: unknown) => {
    if (!isTrustedRenderer(event) || !database)
      throw new Error("Unknown renderer requested memories.");
    if (typeof rawQuery !== "string" || rawQuery.length > 500)
      throw new TypeError("Invalid search query.");
    return rawQuery.trim() ? database.searchMemories(rawQuery.trim()) : database.listMemories();
  });
  ipcMain.handle(IPC_CHANNELS.memorySave, (event, rawInput: unknown) => {
    if (!isTrustedRenderer(event) || !database)
      throw new Error("Unknown renderer requested memory save.");
    if (typeof rawInput !== "object" || rawInput === null) throw new TypeError("Invalid memory.");
    const input = rawInput as Partial<MemoryInput>;
    const types = ["preference", "project", "person", "decision", "fact", "routine"];
    if (
      !types.includes(input.type ?? "") ||
      typeof input.content !== "string" ||
      !input.content.trim() ||
      input.content.length > 4000 ||
      !Number.isInteger(input.importance) ||
      (input.importance ?? 0) < 1 ||
      (input.importance ?? 0) > 5
    )
      throw new TypeError("Invalid memory.");
    return database.saveMemory({
      type: input.type as MemoryInput["type"],
      content: input.content,
      importance: input.importance as number,
    });
  });
  ipcMain.handle(IPC_CHANNELS.memoryDelete, (event, rawId: unknown) => {
    if (!isTrustedRenderer(event) || !database)
      throw new Error("Unknown renderer requested memory delete.");
    if (typeof rawId !== "string" || rawId.length > 100) throw new TypeError("Invalid memory id.");
    return database.deleteMemory(rawId);
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 760,
    minWidth: 620,
    minHeight: 620,
    title: "Poko",
    show: true,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const devServerUrl = process.env.ELECTRON_RENDERER_URL;
    if (!devServerUrl || !url.startsWith(devServerUrl)) event.preventDefault();
  });
  mainWindow.on("closed", () => {
    agentCore?.cancelAll();
    mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app
  .whenReady()
  .then(async () => {
    const userDataDirectory = app.getPath("userData");
    database = await PokoDatabase.open(
      join(userDataDirectory, "poko.sqlite"),
      join(app.getAppPath(), "drizzle"),
      join(userDataDirectory, "settings.json"),
    );
    const codingSkill = await readFile(
      join(app.getAppPath(), "skills/coding/SKILL.md"),
      "utf8",
    ).catch(() => "");
    screenService = new ScreenService(
      join(app.getAppPath(), "native", "build", "poko-ax"),
      join(userDataDirectory, "screen-tmp"),
    );
    await screenService.cleanupAll().catch(() => undefined);
    const executable = await resolveCodexExecutable();
    agentCore = new AgentCore(
      new CodexAppServerProvider({ executable }),
      (payload: TaskEventPayload) => {
        const event = payload.event;
        // A finished screen task's screenshot and work folder are removed right away.
        const tempDir = screenTempDirs.get(payload.taskId);
        if (tempDir && ["completed", "error", "cancelled"].includes(event.type)) {
          screenTempDirs.delete(payload.taskId);
          void screenService?.cleanup(tempDir);
        }
        let rendererPayload = payload;
        if (event.type === "approvalRequired") {
          const request: ApprovalRequest = { taskId: payload.taskId, ...event };
          try {
            database?.recordApprovalRequest(request);
          } catch (error) {
            console.error("Could not persist approval request.", error);
            agentCore?.respondToApproval(payload.taskId, event.requestId, "decline");
            rendererPayload = {
              ...payload,
              event: { ...event, canApprove: false, reason: "승인 요청을 저장하지 못했어." },
            };
          }
        }
        const activityMessage =
          event.type === "output"
            ? null
            : event.type === "thinking"
              ? (event.message ?? "요청을 살펴보고 있어.")
              : event.type === "tool"
                ? (event.detail ?? "프로젝트를 살펴보고 있어.")
                : event.type === "started"
                  ? "포코가 요청을 확인했어."
                  : event.type === "completed"
                    ? "프로젝트 확인을 마쳤어."
                    : event.type === "approvalRequired"
                      ? event.canApprove
                        ? "포코가 다음 작업의 확인을 기다리고 있어."
                        : "안전한 확인 정보가 없어 요청을 거절했어."
                      : event.type === "cancelled"
                        ? "요청을 멈췄어."
                        : "작업을 마치지 못했어.";
        const result =
          event.type === "completed"
            ? event.result
            : event.type === "error"
              ? event.error
              : event.type === "cancelled"
                ? "요청을 멈췄어."
                : undefined;
        try {
          if (event.type !== "approvalRequired") {
            database?.recordTaskEvent(payload.taskId, event.type, activityMessage, result);
          }
        } catch (error) {
          console.error("Could not persist task event.", error);
        }
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
        mainWindow.webContents.send(IPC_CHANNELS.taskEvent, rendererPayload);
      },
      codingSkill,
    );
    registerIpcHandlers();
    await createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  })
  .catch(() => {
    dialog.showErrorBox(
      "Poko를 시작하지 못했어",
      "로컬 데이터베이스를 열지 못했어. 저장 공간을 확인한 뒤 다시 실행해 줘.",
    );
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitAfterTasks = false;
app.on("before-quit", (event) => {
  if (agentCore?.hasActiveTasks) {
    event.preventDefault();
    if (quitAfterTasks) return;
    quitAfterTasks = true;
    agentCore.cancelAll();
    void agentCore.whenIdle().then(() => app.quit());
    return;
  }
  if (database) {
    database.close();
    database = null;
  }
});
