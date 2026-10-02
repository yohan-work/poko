import { BrowserWindow, type IpcMainInvokeEvent, screen } from "electron";
import { type AgentEvent, IPC_CHANNELS, type QuickState } from "../shared";
import { IDLE_STATE, reduceQuickState } from "./quickState";

const WIDTH = 640;
const HEIGHT = 440;

/**
 * The quick panel: a small window over any app that asks Poko one question. It can only ask,
 * hide, and open the app; everything else stays with the main window.
 */
export class QuickPanel {
  private window: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private state: QuickState = IDLE_STATE;
  /** The last height that fits the panel's content (see resize). */
  private height = HEIGHT;
  private readonly itemId = { current: null as string | null };

  constructor(
    private readonly preloadPath: string,
    private readonly rendererUrl: string | undefined,
    private readonly rendererFile: string,
  ) {}

  /** Whether an IPC call came from the panel's own page. */
  owns(event: IpcMainInvokeEvent): boolean {
    const window = this.window;
    return Boolean(
      window &&
        !window.isDestroyed() &&
        event.sender === window.webContents &&
        event.senderFrame === window.webContents.mainFrame,
    );
  }

  get taskId(): string | null {
    return this.state.taskId;
  }

  /** Shows the panel near the top of the display under the mouse. */
  async show(): Promise<void> {
    const window = await this.ensureWindow();
    if (window.isDestroyed()) return;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    window.setBounds({
      x: Math.round(display.x + (display.width - WIDTH) / 2),
      y: Math.round(display.y + display.height * 0.18),
      width: WIDTH,
      height: this.height,
    });
    this.send();
    window.show();
    window.focus();
  }

  /** Fits the window to the panel; the transparent rest would still block clicks below. */
  resize(contentHeight: number): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const height = Math.round(Math.min(Math.max(contentHeight, 60), HEIGHT));
    this.height = height;
    const bounds = window.getBounds();
    if (bounds.height !== height) window.setBounds({ ...bounds, height });
  }

  hide(): void {
    if (this.window && !this.window.isDestroyed()) this.window.hide();
  }

  toggle(): Promise<void> | void {
    if (this.window?.isVisible()) return this.hide();
    return this.show();
  }

  /** A new question started a task. */
  begin(question: string, taskId: string, conversationId: string): void {
    this.itemId.current = null;
    this.state = {
      phase: "running",
      question,
      answer: "",
      message: "포코가 요청을 살펴보고 있어.",
      conversationId,
      taskId,
    };
    this.send();
  }

  /** A question that couldn't start: busy, no folder, and so on. */
  refuse(question: string, message: string): void {
    this.state = { ...IDLE_STATE, phase: "error", question, message };
    this.send();
  }

  /** The main window answered the panel task's approval; it goes on working. */
  resume(taskId: string): void {
    if (this.state.taskId !== taskId || this.state.phase !== "approval") return;
    this.state = { ...this.state, phase: "running", message: "이어서 작업하고 있어." };
    this.send();
  }

  /** The panel task's answer so far, for a main window taking the task over. */
  answerFor(taskId: string): string | undefined {
    return this.state.taskId === taskId && this.state.answer ? this.state.answer : undefined;
  }

  /** An event of the panel's own task. */
  update(event: AgentEvent): void {
    this.state = reduceQuickState(this.state, event, this.itemId);
    this.send();
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.ready = null;
  }

  private send(): void {
    const window = this.window;
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(IPC_CHANNELS.quickState, this.state);
  }

  private async ensureWindow(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed() && this.ready) {
      await this.ready;
      return this.window;
    }
    const window = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: true,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.setAlwaysOnTop(true, "floating");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    this.window = window;
    this.ready = (
      this.rendererUrl
        ? window.loadURL(`${this.rendererUrl}#quick`)
        : window.loadFile(this.rendererFile, { hash: "quick" })
    ).then(
      () => undefined,
      (error: unknown) => console.error("Could not load the quick panel.", error),
    );
    await this.ready;
    return window;
  }
}
