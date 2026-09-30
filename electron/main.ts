import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { IPC_CHANNELS, type TaskEventPayload, type WorkspaceInfo } from "./shared";
import { AgentCore } from "./agent/AgentCore";
import { resolveWorkspaceDirectory } from "./agent/workspace";
import { CodexProvider, resolveCodexExecutable } from "./providers/codex/CodexProvider";
import { readWorkspacePath, writeWorkspacePath } from "./settings";

let mainWindow: BrowserWindow | null = null;
let settingsFile = "";
let agentCore: AgentCore | null = null;

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

    return workspaceInfo(await readWorkspacePath(settingsFile));
  });

  ipcMain.handle(IPC_CHANNELS.workspaceSelect, async (event) => {
    if (!isTrustedRenderer(event) || !mainWindow) {
      throw new Error("Unknown renderer requested workspace selection.");
    }

    const parentWindow = mainWindow;
    const currentPath = await readWorkspacePath(settingsFile);
    const selection = await dialog.showOpenDialog(parentWindow, {
      title: "작업할 폴더 선택",
      defaultPath: currentPath ?? undefined,
      properties: ["openDirectory"],
    });

    if (selection.canceled || selection.filePaths.length === 0) return null;

    const [selectedPath] = selection.filePaths;
    await writeWorkspacePath(settingsFile, selectedPath);
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

    const workspacePath = await readWorkspacePath(settingsFile);
    const cwd = await resolveWorkspaceDirectory(workspacePath);
    const taskId = agentCore.startTask({ prompt: rawMessage.trim(), cwd });
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

app.whenReady().then(async () => {
  settingsFile = join(app.getPath("userData"), "settings.json");
  const codingSkill = await readFile(
    join(app.getAppPath(), "skills/coding/SKILL.md"),
    "utf8",
  ).catch(() => "");
  const executable = await resolveCodexExecutable();
  agentCore = new AgentCore(
    new CodexProvider({ executable }),
    (payload: TaskEventPayload) => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      mainWindow.webContents.send(IPC_CHANNELS.taskEvent, payload);
    },
    codingSkill,
  );
  registerIpcHandlers();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitAfterTasks = false;
app.on("before-quit", (event) => {
  if (!agentCore?.hasActiveTasks) return;
  event.preventDefault();
  if (quitAfterTasks) return;
  quitAfterTasks = true;
  agentCore.cancelAll();
  void agentCore.whenIdle().then(() => app.quit());
});
