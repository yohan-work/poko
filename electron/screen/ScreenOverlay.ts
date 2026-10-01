import { BrowserWindow, screen } from "electron";
import { IPC_CHANNELS, type OverlayScene } from "../shared";
import type { Frame } from "./axHelper";

/** How long Poko stays on screen for each element it points at. */
const POINT_MS = 3200;
const EXTRA_MS = 1200;

/**
 * Poko's on-screen character: a transparent, click-through window over one display.
 * It never takes focus and never sends anything back; it only shows what main tells it.
 */
export class ScreenOverlay {
  private window: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private hideTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly preloadPath: string,
    private readonly rendererUrl: string | undefined,
    private readonly rendererFile: string,
  ) {}

  /** The display holding most of a window frame, in global points. */
  displayFor(frame: Frame): Frame {
    return screen.getDisplayMatching({
      x: Math.round(frame.x),
      y: Math.round(frame.y),
      width: Math.round(frame.width),
      height: Math.round(frame.height),
    }).bounds;
  }

  async show(scene: OverlayScene, display: Frame): Promise<void> {
    const window = await this.ensureWindow();
    if (window.isDestroyed()) return;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    window.setBounds(display);
    window.webContents.send(IPC_CHANNELS.overlayScene, scene);
    window.showInactive();
    this.hideTimer = setTimeout(() => this.hide(), scene.points.length * POINT_MS + EXTRA_MS);
    this.hideTimer.unref?.();
  }

  /** Hides right away, for example before a capture, so Poko never covers what it reads. */
  async hide(): Promise<void> {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    const window = this.window;
    if (!window || window.isDestroyed() || !window.isVisible()) return;
    window.webContents.send(IPC_CHANNELS.overlayHide);
    window.hide();
    // Give the window server a frame to remove the overlay before anything is captured.
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  destroy(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.ready = null;
  }

  private async ensureWindow(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed() && this.ready) {
      await this.ready;
      return this.window;
    }
    const window = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.setIgnoreMouseEvents(true);
    window.setAlwaysOnTop(true, "screen-saver");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Only an extra layer: window capture already records just the picked window.
    window.setContentProtection(true);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    this.window = window;
    this.ready = (
      this.rendererUrl
        ? window.loadURL(`${this.rendererUrl}#overlay`)
        : window.loadFile(this.rendererFile, { hash: "overlay" })
    ).then(() => undefined);
    await this.ready;
    return window;
  }
}
