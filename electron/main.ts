import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { basename, join } from "node:path";
import { IPC_CHANNELS, type ConversationReply, type WorkspaceInfo } from "./shared";
import { readWorkspacePath, writeWorkspacePath } from "./settings";

let mainWindow: BrowserWindow | null = null;
let settingsFile = "";

function workspaceInfo(workspacePath: string | null): WorkspaceInfo | null {
  if (!workspacePath) return null;
  return { path: workspacePath, name: basename(workspacePath) };
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.workspaceGet, async (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error("Unknown renderer requested the workspace.");
    }

    return workspaceInfo(await readWorkspacePath(settingsFile));
  });

  ipcMain.handle(IPC_CHANNELS.workspaceSelect, async (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error("Unknown renderer requested workspace selection.");
    }

    const currentPath = await readWorkspacePath(settingsFile);
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: "작업할 폴더 선택",
      defaultPath: currentPath ?? undefined,
      properties: ["openDirectory"],
    });

    if (selection.canceled || selection.filePaths.length === 0) return null;

    const [selectedPath] = selection.filePaths;
    await writeWorkspacePath(settingsFile, selectedPath);
    return workspaceInfo(selectedPath);
  });

  ipcMain.handle(
    IPC_CHANNELS.conversationSend,
    async (event, rawMessage: unknown): Promise<ConversationReply> => {
      if (!mainWindow || event.sender !== mainWindow.webContents) {
        throw new Error("Unknown renderer sent a conversation message.");
      }
      if (typeof rawMessage !== "string" || rawMessage.trim().length === 0) {
        throw new TypeError("A non-empty message is required.");
      }

      return {
        content:
          "아직 코딩 도구는 연결 전이야. 다음 단계에서 Codex를 연결하면 선택한 프로젝트를 직접 살펴볼 수 있어.",
      };
    },
  );
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

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  settingsFile = join(app.getPath("userData"), "settings.json");
  registerIpcHandlers();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
