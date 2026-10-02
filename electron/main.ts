import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  type IpcMainInvokeEvent,
} from "electron";
import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  IPC_CHANNELS,
  type ApprovalChoice,
  type ApprovalOutcome,
  type ApprovalRequest,
  type MemoryInput,
  type PersistedConversation,
  type TaskEventPayload,
  type WorkspaceInfo,
} from "./shared";
import { AgentCore } from "./agent/AgentCore";
import { resolveWorkspaceDirectory } from "./agent/workspace";
import { CodexAppServerProvider } from "./providers/codex/CodexAppServerProvider";
import { ConversationGoneError, PokoDatabase } from "./database/Database";
import { ScreenService } from "./screen/ScreenService";
import { type AxElement, HelperError, type WindowSnapshot } from "./screen/axHelper";
import type { Capture } from "./screen/ScreenAgent";
import { randomUUID } from "node:crypto";
import { ScreenOverlay } from "./screen/ScreenOverlay";
import { ScreenAgent } from "./screen/ScreenAgent";
import { EditManager } from "./edits/EditManager";
import { SetupService } from "./setup/SetupService";
import { buildOverlayScene, citedElements, replaceCitations } from "./screen/overlayScene";

let mainWindow: BrowserWindow | null = null;
let agentCore: AgentCore | null = null;
let database: PokoDatabase | null = null;
let screenService: ScreenService | null = null;
let screenOverlay: ScreenOverlay | null = null;
let screenProvider: CodexAppServerProvider | null = null;
/** The running "act" task, if any. Only one task of any kind runs at a time. */
let screenRun: { taskId: string; agent: ScreenAgent; done: Promise<void> } | null = null;
/** The only global shortcut: it stops a screen task at once. */
const STOP_SHORTCUT = "CommandOrControl+Shift+Escape";
/** Running screen tasks: their temp folder (screenshot and empty work folder) and snapshot. */
const screenTasks = new Map<string, { tempDir: string; snapshot: WindowSnapshot }>();

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

  handleTaskStart(IPC_CHANNELS.taskStart, async (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !agentCore) {
      throw new Error("Unknown renderer requested a task.");
    }
    const request = (typeof raw === "object" && raw !== null ? raw : {}) as {
      message?: unknown;
      conversationId?: unknown;
    };
    const rawMessage = request.message;
    const conversationId = readConversationId(request.conversationId);
    if (typeof rawMessage !== "string" || rawMessage.trim().length === 0) {
      throw new TypeError("A non-empty message is required.");
    }
    if (rawMessage.length > 10_000) {
      throw new TypeError("The request is too long.");
    }

    if (screenRun) throw new Error("Poko is busy with a screen task.");
    const workspacePath = database?.getWorkspace() ?? null;
    const cwd = await resolveWorkspaceDirectory(workspacePath);
    // A screen task may have started while the folder was being checked.
    if (screenRun) throw new Error("Poko is busy with a screen task.");
    if (!database) throw new Error("Local storage is unavailable.");
    const started = recordTaskStart(database, rawMessage.trim(), cwd, conversationId);
    if ("error" in started) return started;
    const { taskId } = started;
    try {
      const context = database?.getTaskContext(taskId);
      agentCore.startTask({
        prompt: rawMessage.trim(),
        cwd,
        taskId,
        context,
        editsEnabled: database.isEditsEnabled(cwd),
      });
    } catch (error) {
      database?.recordTaskEvent(
        taskId,
        "error",
        "작업을 시작하지 못했어.",
        "작업을 시작하지 못했어.",
      );
      throw error;
    }
    return started;
  });

  ipcMain.handle(IPC_CHANNELS.conversationOpen, (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !database || !agentCore)
      throw new Error("Unknown renderer requested a conversation.");
    const id = readConversationId(raw);
    // A running task's messages, stream, and approval card belong to its conversation.
    if (agentCore.hasActiveTasks || screenRun)
      return { error: "포코가 작업 중이라 다른 대화로 옮길 수 없어. 끝난 뒤에 다시 골라 줘." };
    if (id !== null && !database.getConversation(id)) return { error: CONVERSATION_GONE };
    database.setActiveConversation(id);
    return { messages: id === null ? [] : database.getConversationMessages(id) };
  });

  ipcMain.handle(IPC_CHANNELS.setupStatus, async (event) => {
    if (!isTrustedRenderer(event) || !setupService)
      throw new Error("Unknown renderer asked for setup.");
    return setupService.refresh();
  });

  ipcMain.handle(IPC_CHANNELS.setupLogin, (event) => {
    if (!isTrustedRenderer(event) || !setupService)
      throw new Error("Unknown renderer started a login.");
    return setupService.startLogin();
  });

  ipcMain.handle(IPC_CHANNELS.setupCancelLogin, (event) => {
    if (!isTrustedRenderer(event) || !setupService)
      throw new Error("Unknown renderer cancelled a login.");
    setupService.cancelLogin();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.editsGet, async (event) => {
    if (!isTrustedRenderer(event) || !database)
      throw new Error("Unknown renderer asked for edits.");
    const workspacePath = database.getWorkspace();
    if (!workspacePath) return { available: false, enabled: false };
    const realPath = await resolveWorkspaceDirectory(workspacePath);
    return { available: true, enabled: database.isEditsEnabled(realPath) };
  });

  ipcMain.handle(IPC_CHANNELS.editsSet, async (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !database || !agentCore)
      throw new Error("Unknown renderer changed edits.");
    if (typeof raw !== "boolean") throw new TypeError("Invalid edits setting.");
    const workspacePath = database.getWorkspace();
    if (!workspacePath) return { error: "먼저 작업할 폴더를 선택해 줘." };
    const realPath = await resolveWorkspaceDirectory(workspacePath);
    database.setEditsEnabled(realPath, raw);
    const declined: Array<{ taskId: string; requestId: string }> = [];
    if (!raw) {
      // A change shown before edits were turned off must not apply afterwards. Only this
      // folder's changes are withdrawn; the renderer removes exactly these cards.
      for (const pending of database.pendingFileChanges(realPath)) {
        if (database.resolveApproval(pending.taskId, pending.requestId, "decline")) {
          agentCore.respondToApproval(pending.taskId, pending.requestId, "decline");
          declined.push(pending);
        }
      }
    }
    return { available: true, enabled: raw, declined };
  });

  ipcMain.handle(IPC_CHANNELS.conversationRename, (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !database)
      throw new Error("Unknown renderer renamed a conversation.");
    const request = (typeof raw === "object" && raw !== null ? raw : {}) as {
      conversationId?: unknown;
      title?: unknown;
    };
    const id = readConversationId(request.conversationId);
    if (id === null || typeof request.title !== "string" || request.title.length > 400)
      throw new TypeError("Invalid rename request.");
    const title = request.title.replace(/\s+/g, " ").trim();
    if (!title) return { error: "제목을 적어 줘." };
    if (Array.from(title).length > 80) return { error: "제목은 80자까지 쓸 수 있어." };
    return database.renameConversation(id, title) ? { ok: true } : { error: CONVERSATION_GONE };
  });

  ipcMain.handle(IPC_CHANNELS.conversationDelete, async (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !database)
      throw new Error("Unknown renderer deleted a conversation.");
    const id = readConversationId(raw);
    if (id === null) throw new TypeError("Invalid conversation id.");
    // A running task's reply and approval card belong to its conversation, and a task that is
    // still starting (capturing the screen, checking the folder) is about to be recorded there.
    if (database.hasRunningTask(id) || (startingConversations.get(id) ?? 0) > 0)
      return { error: "포코가 이 대화에서 작업 중이라 지금은 지울 수 없어." };
    await editManager?.forgetConversation(id);
    return database.deleteConversation(id) ? { ok: true } : { error: CONVERSATION_GONE };
  });

  ipcMain.handle(IPC_CHANNELS.editsList, (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !editManager)
      throw new Error("Unknown renderer asked for edits.");
    const id = readConversationId(raw);
    return id === null ? [] : editManager.notes(id);
  });

  ipcMain.handle(IPC_CHANNELS.editsUndo, async (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !database || !agentCore || !editManager)
      throw new Error("Unknown renderer asked to undo.");
    if (typeof raw !== "string" || raw.length > 100) throw new TypeError("Invalid edit id.");
    // Codex may be changing the same files right now.
    if (agentCore.hasActiveTasks || screenRun)
      return { error: "포코가 작업 중이라 끝난 뒤에 되돌릴 수 있어." };
    const edit = database.getEdit(raw);
    const failure = await editManager.undo(raw);
    if (failure) return { error: failure };
    if (edit?.conversationId) notifyEditsChanged(edit.conversationId);
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.taskCancel, (event, rawTaskId: unknown) => {
    if (!isTrustedRenderer(event) || !agentCore) {
      throw new Error("Unknown renderer requested task cancellation.");
    }
    if (typeof rawTaskId !== "string" || rawTaskId.length > 100) {
      throw new TypeError("A valid task id is required.");
    }
    if (screenRun?.taskId === rawTaskId) {
      screenRun.agent.stop();
      return true;
    }
    return agentCore.cancelTask(rawTaskId);
  });

  ipcMain.handle(IPC_CHANNELS.approvalRespond, async (event, rawRequest: unknown) => {
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
    if (screenRun?.taskId === request.taskId) {
      const { agent } = screenRun;
      if (!agent.hasPending(request.requestId)) return "stale";
      const choice = request.choice as ApprovalChoice;
      if (!database.resolveApproval(request.taskId, request.requestId, choice)) return "stale";
      return agent.respond(request.requestId, choice) ? "applied" : "stale";
    }
    if (!agentCore.hasPendingApproval(request.taskId, request.requestId)) return "stale";
    const key = `${request.taskId}:${request.requestId}`;
    if (answering.has(key)) return "stale";
    answering.add(key);
    try {
      return await answerApproval(
        request.taskId,
        request.requestId,
        request.choice as ApprovalChoice,
      );
    } finally {
      answering.delete(key);
    }
  });

  /** Decides, checkpoints an approved file change, records, and answers Codex. */
  async function answerApproval(
    taskId: string,
    requestId: string,
    requested: ApprovalChoice,
  ): Promise<ApprovalOutcome> {
    if (!database || !agentCore) return "stale";
    const request = { taskId, requestId, choice: requested };
    // Decide before recording, so the audit row always matches what Codex receives. A file change
    // also needs edits still on for its workspace: turning them off withdraws earlier cards.
    const workspace = database.getTaskWorkspace(request.taskId);
    const fileChange =
      database.getApprovalKind(request.taskId, request.requestId) === "file_change";
    const editsWithdrawn = fileChange && !(workspace && database.isEditsEnabled(workspace));
    const unsafe =
      request.choice === "approve" &&
      (editsWithdrawn || !agentCore.canStillApprove(request.taskId, request.requestId));
    let declineInstead = unsafe;
    if (!unsafe && request.choice === "approve" && workspace && fileChange) {
      // The change Codex made before this one is on disk by now; settle it first so each
      // edit's "after" state is its own. Then save the files this change will touch.
      try {
        await settleEdits(request.taskId);
        const paths = agentCore.fileChangePaths(request.taskId, request.requestId);
        if (!paths || !editManager) throw new Error("No file change to checkpoint.");
        await editManager.checkpoint(request.taskId, request.requestId, workspace, paths);
      } catch (error) {
        console.error("Could not checkpoint a file change; declining it.", error);
        declineInstead = true;
      }
    }
    const choice: ApprovalChoice = declineInstead ? "decline" : request.choice;
    if (!database.resolveApproval(request.taskId, request.requestId, choice)) return "stale";
    if (!agentCore.respondToApproval(request.taskId, request.requestId, choice)) {
      console.error("The decision was recorded but could not be sent to Codex.");
      return "stale";
    }
    return declineInstead ? "declined_unsafe" : "applied";
  }

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
  handleTaskStart(IPC_CHANNELS.screenLook, async (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !database || !agentCore || !screenService)
      throw new Error("Unknown renderer requested a screen look.");
    const request = (typeof raw === "object" && raw !== null ? raw : {}) as {
      windowId?: unknown;
      question?: unknown;
      conversationId?: unknown;
    };
    if (
      !Number.isSafeInteger(request.windowId) ||
      typeof request.question !== "string" ||
      request.question.length > 10_000
    )
      throw new TypeError("Invalid screen request.");
    if (!database.isScreenNoticeAccepted()) return { error: "먼저 화면 보기 안내를 확인해 줘." };
    if (agentCore.hasActiveTasks || screenRun)
      return { error: "포코가 이미 다른 작업을 하고 있어. 잠시만 기다려 줘." };

    let look: Awaited<ReturnType<ScreenService["prepareLook"]>>;
    try {
      // Poko leaves the screen before it looks, so it never covers what it reads.
      await screenOverlay?.hide();
      look = await screenService.prepareLook(request.windowId as number, request.question);
    } catch (error) {
      const code = error instanceof HelperError ? error.code : "";
      return {
        error: screenErrors[code] ?? "화면을 가져오지 못했어. 권한을 확인하고 다시 시도해 줘.",
      };
    }
    // Another task may have started while the window was being captured.
    if (agentCore.hasActiveTasks || screenRun) {
      void screenService.cleanup(look.tempDir);
      return { error: "포코가 이미 다른 작업을 하고 있어. 잠시만 기다려 줘." };
    }
    const question = request.question.trim() || "이 화면을 설명해 줘.";
    const started = recordTaskStart(
      database,
      `🖥️ ${look.app} 화면 보기: ${question}`,
      `screen:${look.app}`,
      readConversationId(request.conversationId),
    );
    if ("error" in started) {
      void screenService.cleanup(look.tempDir);
      return started;
    }
    const { taskId } = started;
    screenTasks.set(taskId, { tempDir: look.tempDir, snapshot: look.snapshot });
    try {
      agentCore.startTask({
        prompt: look.prompt,
        cwd: look.workDir,
        taskId,
        screen: { images: [look.imagePath] },
      });
    } catch {
      screenTasks.delete(taskId);
      void screenService.cleanup(look.tempDir);
      database.recordTaskEvent(
        taskId,
        "error",
        "작업을 시작하지 못했어.",
        "작업을 시작하지 못했어.",
      );
      return { error: "작업을 시작하지 못했어. 잠시 뒤 다시 시도해 줘." };
    }
    return started;
  });

  handleTaskStart(IPC_CHANNELS.screenAct, async (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !database || !agentCore || !screenService || !screenProvider)
      throw new Error("Unknown renderer requested a screen task.");
    const request = (typeof raw === "object" && raw !== null ? raw : {}) as {
      windowId?: unknown;
      goal?: unknown;
      conversationId?: unknown;
    };
    if (
      !Number.isSafeInteger(request.windowId) ||
      typeof request.goal !== "string" ||
      !request.goal.trim() ||
      request.goal.length > 10_000
    )
      throw new TypeError("Invalid screen request.");
    if (!database.isScreenNoticeAccepted()) return { error: "먼저 화면 보기 안내를 확인해 줘." };
    if (agentCore.hasActiveTasks || screenRun)
      return { error: "포코가 이미 다른 작업을 하고 있어. 잠시만 기다려 줘." };
    const windowId = request.windowId as number;
    const goal = request.goal.trim();
    const window = (await screenService.listWindows()).find((item) => item.id === windowId);
    if (!window) return { error: screenErrors.window_not_found };
    if (!window.canAct) return { error: "이 앱에서는 보기만 할 수 있어. 브라우저 창을 골라 줘." };
    if (agentCore.hasActiveTasks || screenRun)
      return { error: "포코가 이미 다른 작업을 하고 있어. 잠시만 기다려 줘." };

    const started = recordTaskStart(
      database,
      `🖱️ ${window.app}: ${goal}`,
      `screen:${window.app}`,
      readConversationId(request.conversationId),
    );
    if ("error" in started) return started;
    const { taskId } = started;
    const service = screenService;
    const provider = screenProvider;
    const agent = new ScreenAgent({
      // Each look brings the browser forward: another app's window must not cover the page.
      capture: async (id) => {
        await service.raise(id);
        return service.capture(id);
      },
      ask: (prompt, capture, signal) => askCodex(provider, taskId, prompt, capture, signal),
      act: (id, actRequest) => service.act(id, actRequest),
      emit: (agentEvent) => {
        deliverTaskEvent({ taskId, event: agentEvent });
        // The card is the only place to approve, so Poko comes forward to show it.
        if (agentEvent.type === "approvalRequired") showMainWindow();
      },
      point: (snapshot, element, say) => void pointAtElement(snapshot, element, say),
      hideOverlay: async () => {
        await screenOverlay?.hide();
      },
      ownPid: process.pid,
    });
    if (!globalShortcut.register(STOP_SHORTCUT, () => screenRun?.agent.stop()))
      console.error("Could not register the stop shortcut.");
    const done = agent.run(windowId, goal).finally(() => {
      globalShortcut.unregister(STOP_SHORTCUT);
      if (screenRun?.agent === agent) screenRun = null;
    });
    screenRun = { taskId, agent, done };
    return started;
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

/** One Codex turn for a screen step: nothing streams to the chat, only the final answer. */
async function askCodex(
  provider: CodexAppServerProvider,
  taskId: string,
  prompt: string,
  capture: Capture,
  signal: AbortSignal,
): Promise<string> {
  for await (const event of provider.runTask(
    {
      id: `${taskId}:${randomUUID()}`,
      prompt,
      cwd: capture.workDir,
      mode: "read",
      profile: "screen",
      images: [capture.imagePath],
    },
    { signal },
  )) {
    if (event.type === "completed") return event.result;
    if (event.type === "error") throw new Error(event.error);
    if (event.type === "cancelled") throw new Error("cancelled");
  }
  throw new Error("Codex ended without an answer.");
}

/** Conversations a task is being started in, counted until the task is recorded or refused. */
const startingConversations = new Map<string, number>();

/** Registers a task-starting handler, marking its conversation as starting while it runs. */
function handleTaskStart(
  channel: string,
  handler: (event: IpcMainInvokeEvent, raw: unknown) => Promise<unknown>,
): void {
  ipcMain.handle(channel, async (event, raw: unknown) => {
    const id =
      typeof raw === "object" && raw !== null && "conversationId" in raw
        ? (raw as { conversationId: unknown }).conversationId
        : null;
    const key = typeof id === "string" ? id : null;
    if (key) startingConversations.set(key, (startingConversations.get(key) ?? 0) + 1);
    try {
      return await handler(event, raw);
    } finally {
      if (key) {
        const left = (startingConversations.get(key) ?? 1) - 1;
        if (left > 0) startingConversations.set(key, left);
        else startingConversations.delete(key);
      }
    }
  });
}

/** Approval answers in progress, so a double click can't checkpoint or answer twice. */
const answering = new Set<string>();
let editManager: EditManager | null = null;
let setupService: SetupService | null = null;

/** Settles a task's pending edits and tells the renderer when its conversation's edits changed. */
async function settleEdits(taskId: string): Promise<void> {
  if (!editManager || !database) return;
  if (await editManager.settle(taskId)) {
    const conversation = database.getTaskConversation(taskId);
    if (conversation) notifyEditsChanged(conversation.id);
  }
}

function notifyEditsChanged(conversationId: string): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(IPC_CHANNELS.editsChanged, conversationId);
}

const CONVERSATION_GONE = "이 대화를 찾을 수 없어. 새 대화로 다시 보내 줘.";

/** A conversation id from the renderer: a short string, or null for a new conversation. */
function readConversationId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 100)
    throw new TypeError("Invalid conversation id.");
  return value;
}

/**
 * Records the user's message and a running task in the conversation (a new one for null),
 * makes that conversation the active one, and returns it. An id that no longer exists is
 * refused plainly instead of failing in the database.
 */
function recordTaskStart(
  store: PokoDatabase,
  message: string,
  workspace: string,
  conversationId: string | null,
): { taskId: string; conversation: PersistedConversation } | { error: string } {
  let taskId: string;
  try {
    taskId = store.createTask(message, workspace, conversationId);
  } catch (error) {
    if (error instanceof ConversationGoneError) return { error: CONVERSATION_GONE };
    throw error;
  }
  const conversation = store.getTaskConversation(taskId);
  if (!conversation) throw new Error("The task's conversation was not recorded.");
  store.setActiveConversation(conversation.id);
  return { taskId, conversation };
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  app.focus({ steal: true });
}

async function pointAtElement(
  snapshot: WindowSnapshot,
  element: AxElement,
  say: string,
): Promise<void> {
  if (!screenOverlay) return;
  try {
    const display = screenOverlay.displayFor(snapshot.window.frame);
    const scene = buildOverlayScene(snapshot, [element], display, say);
    if (scene) await screenOverlay.show(scene, display, { hold: true });
  } catch (error) {
    console.error("Could not show Poko on screen.", error);
  }
}

async function pointAt(snapshot: WindowSnapshot, answer: string): Promise<void> {
  if (!screenOverlay) return;
  try {
    const display = screenOverlay.displayFor(snapshot.window.frame);
    const scene = buildOverlayScene(snapshot, citedElements(answer, snapshot, display), display);
    if (scene) await screenOverlay.show(scene, display);
  } catch (error) {
    console.error("Could not show Poko on screen.", error);
  }
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
    screenRun?.agent.stop();
    screenOverlay?.destroy();
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
    editManager = new EditManager(database, join(userDataDirectory, "checkpoints"));
    await editManager.expireOld().catch((error) => console.error("Could not expire edits.", error));
    screenService = new ScreenService(
      join(app.getAppPath(), "native", "build", "poko-ax"),
      join(userDataDirectory, "screen-tmp"),
    );
    await screenService.cleanupAll().catch(() => undefined);
    screenOverlay = new ScreenOverlay(
      join(__dirname, "../preload/preload.js"),
      process.env.ELECTRON_RENDERER_URL,
      join(__dirname, "../renderer/index.html"),
    );
    setupService = new SetupService((status) => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send(IPC_CHANNELS.setupChanged, status);
    });
    await setupService
      .refresh()
      .catch((error) => console.error("Codex setup check failed.", error));
    const { runtime } = setupService;
    screenProvider = new CodexAppServerProvider({ runtime });
    agentCore = new AgentCore(
      new CodexAppServerProvider({ runtime }),
      deliverTaskEvent,
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

/** Records a task event and sends it on, for Codex tasks and screen tasks alike. */
function deliverTaskEvent(incoming: TaskEventPayload): void {
  let payload = incoming;
  const screenTask = screenTasks.get(payload.taskId);
  if (screenTask && ["completed", "error", "cancelled"].includes(payload.event.type)) {
    // A finished screen task's screenshot and work folder are removed right away.
    screenTasks.delete(payload.taskId);
    void screenService?.cleanup(screenTask.tempDir);
    if (payload.event.type === "completed") {
      const { snapshot } = screenTask;
      const answer = payload.event.result;
      // Poko flies to what it talked about, and the chat names it instead of `[12]`.
      void pointAt(snapshot, answer);
      payload = {
        ...payload,
        event: { ...payload.event, result: replaceCitations(answer, snapshot) },
      };
    }
  }
  const event = payload.event;
  // When a task finishes, its last approved change is on disk (or never happened).
  if (event.type === "completed" || event.type === "error" || event.type === "cancelled")
    void settleEdits(payload.taskId);
  let rendererPayload = payload;
  if (event.type === "approvalRequired") {
    const request: ApprovalRequest = { taskId: payload.taskId, ...event };
    try {
      database?.recordApprovalRequest(request);
    } catch (error) {
      console.error("Could not persist approval request.", error);
      if (screenRun?.taskId === payload.taskId) screenRun.agent.respond(event.requestId, "decline");
      else agentCore?.respondToApproval(payload.taskId, event.requestId, "decline");
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
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitAfterTasks = false;
app.on("before-quit", (event) => {
  globalShortcut.unregisterAll();
  if (screenRun) {
    // Let the stopped task record that it was cancelled before the database closes.
    event.preventDefault();
    const { agent, done } = screenRun;
    agent.stop();
    void done.then(() => app.quit());
    return;
  }
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
