import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  IPC_CHANNELS,
  type ApprovalChoice,
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

let mainWindow: BrowserWindow | null = null;
let agentCore: AgentCore | null = null;
let database: PokoDatabase | null = null;

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
      agentCore.startTask({ prompt: rawMessage.trim(), cwd, taskId });
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
    const choice = request.choice as ApprovalChoice;
    if (!agentCore.hasPendingApproval(request.taskId, request.requestId)) return false;
    if (!database.resolveApproval(request.taskId, request.requestId, choice)) return false;
    if (!agentCore.respondToApproval(request.taskId, request.requestId, choice)) {
      console.error("The approval was recorded but Codex no longer has that request pending.");
      return false;
    }
    return true;
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
    const executable = await resolveCodexExecutable();
    agentCore = new AgentCore(
      new CodexAppServerProvider({ executable }),
      (payload: TaskEventPayload) => {
        const event = payload.event;
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
