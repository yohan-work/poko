import { app, BrowserWindow, dialog, globalShortcut } from "electron";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { IPC_CHANNELS } from "./shared";
import { AgentCore } from "./agent/AgentCore";
import { CodexAppServerProvider } from "./providers/codex/CodexAppServerProvider";
import { PokoDatabase } from "./database/Database";
import { ScreenService } from "./screen/ScreenService";
import { ScreenOverlay } from "./screen/ScreenOverlay";
import { EditManager } from "./edits/EditManager";
import { SetupService } from "./setup/SetupService";
import { ClaudeSetupService } from "./setup/claudeSetup";
import { EngineProvider } from "./agent/EngineProvider";
import { ClaudeCodeProvider } from "./providers/claude/ClaudeCodeProvider";
import { ctx, showMainWindow } from "./app/context";
import { applyQuickShortcut, registerQuickHandlers, toggleQuickPanel } from "./app/quick";
import { QuickPanel } from "./quick/QuickPanel";
import { removeAttachments } from "./attachments/attachments";
import { showTray } from "./quick/tray";
import { deliverTaskEvent } from "./app/events";
import { registerDataHandlers } from "./app/data";
import { registerDictationHandlers } from "./app/dictation";
import {
  registerRoutineHandlers,
  registerRoutineYield,
  startRoutineScheduler,
} from "./app/routines";
import { registerEditsHandlers } from "./app/edits";
import { registerScreenHandlers } from "./app/screen";
import { codexEffortsFor, registerSettingsHandlers } from "./app/settings";
import { registerSetupHandlers } from "./app/setup";
import { registerTaskHandlers } from "./app/tasks";
import { registerWorkspaceHandlers } from "./app/workspace";
import { kickQueue } from "./app/queue";

/** Set when the app is quitting, so closing the main window really closes it. */
let quitting = false;

/** The menu bar icon, with the current shortcut shown next to 포코에게 묻기. */
function refreshTray(): void {
  showTray(
    {
      ask: () => {
        if (!ctx.quickPanel?.visible) void toggleQuickPanel();
      },
      open: () => void openMainWindow(),
    },
    // A shortcut another app owns isn't shown, since pressing it wouldn't open the panel.
    ctx.quickShortcutOk ? (ctx.database?.getSettings().quickShortcut ?? "Alt+Space") : "off",
  );
}

/** Shows the main window, creating it again if it was destroyed. */
async function openMainWindow(): Promise<void> {
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) showMainWindow();
  else await createWindow();
}

function registerIpcHandlers(): void {
  registerWorkspaceHandlers();
  registerTaskHandlers();
  registerSetupHandlers();
  registerEditsHandlers();
  registerScreenHandlers();
  registerSettingsHandlers();
  registerDataHandlers();
  registerQuickHandlers();
  registerDictationHandlers();
  registerRoutineHandlers();
  registerRoutineYield();
}

async function createWindow(): Promise<void> {
  ctx.mainWindow = new BrowserWindow({
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
  ctx.mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // On macOS, closing hides the window: tasks, the shortcut, and the quick panel keep working.
  ctx.mainWindow.on("close", (event) => {
    if (process.platform !== "darwin" || quitting) return;
    event.preventDefault();
    ctx.mainWindow?.hide();
  });
  ctx.mainWindow.webContents.on("will-navigate", (event, url) => {
    const devServerUrl = process.env.ELECTRON_RENDERER_URL;
    if (!devServerUrl || !url.startsWith(devServerUrl)) event.preventDefault();
  });
  ctx.mainWindow.on("closed", () => {
    // Stopping tasks must not start the waiting questions.
    ctx.queueFrozen = true;
    ctx.agentCore?.cancelAll();
    ctx.screenRun?.agent.stop();
    ctx.screenOverlay?.destroy();
    ctx.mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await ctx.mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await ctx.mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app
  .whenReady()
  .then(async () => {
    const userDataDirectory = app.getPath("userData");
    ctx.database = await PokoDatabase.open(
      join(userDataDirectory, "poko.sqlite"),
      join(app.getAppPath(), "drizzle"),
      join(userDataDirectory, "settings.json"),
    );
    const codingSkill = await readFile(
      join(app.getAppPath(), "skills/coding/SKILL.md"),
      "utf8",
    ).catch(() => "");
    ctx.editManager = new EditManager(ctx.database, join(userDataDirectory, "checkpoints"));
    await ctx.editManager
      .expireOld(ctx.database.getSettings().checkpointDays)
      .catch((error) => console.error("Could not expire edits.", error));
    ctx.screenService = new ScreenService(
      // The helper ships beside app.asar in a packaged app (it can't run from inside it).
      app.isPackaged
        ? join(process.resourcesPath, "poko-ax")
        : join(app.getAppPath(), "native", "build", "poko-ax"),
      join(userDataDirectory, "screen-tmp"),
    );
    await ctx.screenService.cleanupAll().catch(() => undefined);
    ctx.screenOverlay = new ScreenOverlay(
      join(__dirname, "../preload/preload.js"),
      process.env.ELECTRON_RENDERER_URL,
      join(__dirname, "../renderer/index.html"),
    );
    ctx.setupService = new SetupService((status) => {
      if (ctx.mainWindow && !ctx.mainWindow.isDestroyed())
        ctx.mainWindow.webContents.send(IPC_CHANNELS.setupChanged, status);
    });
    // Only find Codex here; the setup check runs once the window asks, so startup isn't delayed.
    await ctx.setupService
      .resolveRuntime()
      .catch((error) => console.error("Could not find Codex.", error));
    ctx.claudeSetup = new ClaudeSetupService();
    await ctx.claudeSetup
      .resolveRuntime()
      .catch((error) => console.error("Could not find Claude Code.", error));
    const { runtime } = ctx.setupService;
    const claudeProvider = new ClaudeCodeProvider({
      runtime: ctx.claudeSetup.runtime,
      findTaskProcesses: ctx.screenService.supported
        ? (tempDir, workspace) =>
            ctx.screenService?.findTaskProcesses(tempDir, workspace) ?? Promise.resolve([])
        : undefined,
    });
    // No task runs yet, so temp folders from a crash or a forced quit can go.
    claudeProvider.cleanupLeftovers();
    ctx.screenProvider = new CodexAppServerProvider({ runtime });
    ctx.claudeProvider = claudeProvider;
    ctx.agentCore = new AgentCore(
      new EngineProvider(
        {
          codex: new CodexAppServerProvider({ runtime }),
          claude: claudeProvider,
        },
        () => ctx.database?.getSettings().engine ?? "codex",
        (engine) => {
          const settings = ctx.database?.getSettings();
          return (engine === "claude" ? settings?.claudeModel : settings?.codexModel) ?? null;
        },
        (engine) => {
          const settings = ctx.database?.getSettings();
          if (engine === "claude") return settings?.claudeEffort ?? null;
          const effort = settings?.codexEffort ?? null;
          // A level the chosen model doesn't accept falls back to the model's default.
          const accepted = codexEffortsFor(settings?.codexModel ?? null);
          return effort && accepted && !accepted.includes(effort) ? null : effort;
        },
      ),
      deliverTaskEvent,
      codingSkill,
    );
    // A question sent while Poko was busy starts once the running task has fully ended.
    ctx.agentCore.onIdle(kickQueue);
    ctx.quickPanel = new QuickPanel(
      join(__dirname, "../preload/preload.js"),
      process.env.ELECTRON_RENDERER_URL,
      join(__dirname, "../renderer/index.html"),
    );
    ctx.openMainWindow = openMainWindow;
    // Images from a crash or a forced quit don't outlive a restart.
    ctx.attachmentsRoot = join(userDataDirectory, "attachments");
    await removeAttachments(ctx.attachmentsRoot).catch(() => undefined);
    ctx.refreshTray = refreshTray;
    registerIpcHandlers();
    await createWindow();
    applyQuickShortcut(ctx.database.getSettings().quickShortcut);
    refreshTray();
    // Routines run while Poko runs, window open or not (see docs/phases/phase-15.md).
    startRoutineScheduler();

    // The hidden main window, the quick panel, and the overlay all count as windows, so a Dock
    // click shows the main window instead of checking whether any window exists.
    app.on("activate", () => void openMainWindow());
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
  quitting = true;
  // Waiting questions stay waiting; the next start shows them as not asked.
  ctx.queueFrozen = true;
  globalShortcut.unregisterAll();
  if (ctx.screenRun) {
    // Let the stopped task record that it was cancelled before the ctx.database closes.
    event.preventDefault();
    const { agent, done } = ctx.screenRun;
    agent.stop();
    void done.then(() => app.quit());
    return;
  }
  if (ctx.agentCore?.hasActiveTasks) {
    event.preventDefault();
    if (quitAfterTasks) return;
    quitAfterTasks = true;
    ctx.agentCore.cancelAll();
    void ctx.agentCore.whenIdle().then(() => app.quit());
    return;
  }
  if (ctx.database) {
    ctx.database.close();
    ctx.database = null;
  }
});
