import { globalShortcut, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { IPC_CHANNELS } from "../shared";
import type { CodexAppServerProvider } from "../providers/codex/CodexAppServerProvider";
import type { ScreenService } from "../screen/ScreenService";
import { type AxElement, HelperError, type WindowSnapshot } from "../screen/axHelper";
import type { Capture } from "../screen/ScreenAgent";
import { ScreenAgent } from "../screen/ScreenAgent";
import { buildOverlayScene, citedElements } from "../screen/overlayScene";
import {
  ctx,
  handleTaskStart,
  isTrustedRenderer,
  readConversationId,
  recordTaskStart,
  showMainWindow,
} from "./context";
import { deliverTaskEvent } from "./events";

/** The only global shortcut: it stops a screen task at once. */
export const STOP_SHORTCUT = "CommandOrControl+Shift+Escape";
/** Running screen tasks: their temp folder (screenshot and empty work folder) and snapshot. */
export const screenTasks = new Map<string, { tempDir: string; snapshot: WindowSnapshot }>();

const screenErrors: Record<string, string> = {
  window_not_found: "그 창을 더 이상 찾을 수 없어. 다시 골라 줘.",
  window_not_matched: "고른 창을 정확히 찾지 못했어. 창을 앞으로 가져온 뒤 다시 시도해 줘.",
  window_ambiguous:
    "같은 모양의 창이 여러 개라 하나를 고를 수 없어. 다른 창을 닫고 다시 시도해 줘.",
  no_accessibility: "손쉬운 사용 권한이 필요해.",
  capture_failed: "화면 기록 권한이 필요해.",
  capture_mismatch: "창을 정확히 캡처하지 못했어. 창 크기를 바꾸지 말고 다시 시도해 줘.",
};

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

export async function pointAtElement(
  snapshot: WindowSnapshot,
  element: AxElement,
  say: string,
): Promise<void> {
  if (!ctx.screenOverlay) return;
  try {
    const display = ctx.screenOverlay.displayFor(snapshot.window.frame);
    const scene = buildOverlayScene(snapshot, [element], display, say);
    if (scene) await ctx.screenOverlay.show(scene, display, { hold: true });
  } catch (error) {
    console.error("Could not show Poko on screen.", error);
  }
}

export async function pointAt(snapshot: WindowSnapshot, answer: string): Promise<void> {
  if (!ctx.screenOverlay) return;
  try {
    const display = ctx.screenOverlay.displayFor(snapshot.window.frame);
    const scene = buildOverlayScene(snapshot, citedElements(answer, snapshot, display), display);
    if (scene) await ctx.screenOverlay.show(scene, display);
  } catch (error) {
    console.error("Could not show Poko on screen.", error);
  }
}

/** 화면 보기 and 대신 해 줘. */
export function registerScreenHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.screenStatus, (event) => {
    if (!isTrustedRenderer(event) || !ctx.database || !ctx.screenService)
      throw new Error("Unknown renderer requested screen status.");
    return ctx.screenService.status(ctx.database.isScreenNoticeAccepted());
  });
  ipcMain.handle(IPC_CHANNELS.screenOpenSettings, (event, kind: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.screenService)
      throw new Error("Unknown renderer requested settings.");
    if (kind !== "screen" && kind !== "accessibility") throw new TypeError("Invalid settings.");
    return ctx.screenService.openSettings(kind);
  });
  ipcMain.handle(IPC_CHANNELS.screenAcceptNotice, (event) => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer accepted the screen notice.");
    ctx.database.acceptScreenNotice();
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.screenResetNotice, (event) => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer reset the screen notice.");
    ctx.database.resetScreenNotice();
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.screenListWindows, (event) => {
    if (!isTrustedRenderer(event) || !ctx.screenService)
      throw new Error("Unknown renderer requested windows.");
    return ctx.screenService.listWindows();
  });
  handleTaskStart(IPC_CHANNELS.screenLook, async (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.database || !ctx.agentCore || !ctx.screenService)
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
    if (!ctx.database.isScreenNoticeAccepted())
      return { error: "먼저 화면 보기 안내를 확인해 줘." };
    if (ctx.agentCore.hasActiveTasks || ctx.screenRun)
      return { error: "포코가 이미 다른 작업을 하고 있어. 잠시만 기다려 줘." };

    let look: Awaited<ReturnType<ScreenService["prepareLook"]>>;
    try {
      // Poko leaves the screen before it looks, so it never covers what it reads.
      await ctx.screenOverlay?.hide();
      look = await ctx.screenService.prepareLook(request.windowId as number, request.question);
    } catch (error) {
      const code = error instanceof HelperError ? error.code : "";
      return {
        error: screenErrors[code] ?? "화면을 가져오지 못했어. 권한을 확인하고 다시 시도해 줘.",
      };
    }
    // Another task may have started while the window was being captured.
    if (ctx.agentCore.hasActiveTasks || ctx.screenRun) {
      void ctx.screenService.cleanup(look.tempDir);
      return { error: "포코가 이미 다른 작업을 하고 있어. 잠시만 기다려 줘." };
    }
    const question = request.question.trim() || "이 화면을 설명해 줘.";
    const started = recordTaskStart(
      ctx.database,
      `🖥️ ${look.app} 화면 보기: ${question}`,
      `screen:${look.app}`,
      readConversationId(request.conversationId),
    );
    if ("error" in started) {
      void ctx.screenService.cleanup(look.tempDir);
      return started;
    }
    const { taskId } = started;
    screenTasks.set(taskId, { tempDir: look.tempDir, snapshot: look.snapshot });
    try {
      ctx.agentCore.startTask({
        prompt: look.prompt,
        cwd: look.workDir,
        taskId,
        screen: { images: [look.imagePath] },
      });
    } catch {
      screenTasks.delete(taskId);
      void ctx.screenService.cleanup(look.tempDir);
      ctx.database.recordTaskEvent(
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
    if (
      !isTrustedRenderer(event) ||
      !ctx.database ||
      !ctx.agentCore ||
      !ctx.screenService ||
      !ctx.screenProvider
    )
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
    if (!ctx.database.isScreenNoticeAccepted())
      return { error: "먼저 화면 보기 안내를 확인해 줘." };
    if (ctx.agentCore.hasActiveTasks || ctx.screenRun)
      return { error: "포코가 이미 다른 작업을 하고 있어. 잠시만 기다려 줘." };
    const windowId = request.windowId as number;
    const goal = request.goal.trim();
    const window = (await ctx.screenService.listWindows()).find((item) => item.id === windowId);
    if (!window) return { error: screenErrors.window_not_found };
    if (!window.canAct) return { error: "이 앱에서는 보기만 할 수 있어. 브라우저 창을 골라 줘." };
    if (ctx.agentCore.hasActiveTasks || ctx.screenRun)
      return { error: "포코가 이미 다른 작업을 하고 있어. 잠시만 기다려 줘." };

    const started = recordTaskStart(
      ctx.database,
      `🖱️ ${window.app}: ${goal}`,
      `screen:${window.app}`,
      readConversationId(request.conversationId),
    );
    if ("error" in started) return started;
    const { taskId } = started;
    const service = ctx.screenService;
    const provider = ctx.screenProvider;
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
        await ctx.screenOverlay?.hide();
      },
      ownPid: process.pid,
    });
    if (!globalShortcut.register(STOP_SHORTCUT, () => ctx.screenRun?.agent.stop()))
      console.error("Could not register the stop shortcut.");
    const done = agent.run(windowId, goal).finally(() => {
      globalShortcut.unregister(STOP_SHORTCUT);
      if (ctx.screenRun?.agent === agent) ctx.screenRun = null;
    });
    ctx.screenRun = { taskId, agent, done };
    return started;
  });
}
