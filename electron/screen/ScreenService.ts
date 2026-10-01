import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { desktopCapturer, shell } from "electron";
import type { ScreenStatus, ScreenWindow } from "../shared";
import {
  HelperError,
  parsePermissions,
  parseSnapshot,
  parseWindows,
  runHelper,
  type ScreenWindowInfo,
  type WindowSnapshot,
} from "./axHelper";
import { captureMatchesWindow, windowIdFromSource } from "./capture";
import { buildLookPrompt } from "./lookPrompt";

const SETTINGS_URLS = {
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
} as const;

export interface PreparedLook {
  prompt: string;
  imagePath: string;
  /** Empty folder Codex runs in; it can read nothing else. */
  workDir: string;
  /** Removed when the task ends. */
  tempDir: string;
  app: string;
  /** The elements the prompt listed, so the answer's `[id]` citations can be resolved. */
  snapshot: WindowSnapshot;
}

/** Window capture and accessibility for screen tasks. Main process only. */
export class ScreenService {
  constructor(
    private readonly helperPath: string,
    private readonly tempRoot: string,
  ) {}

  get supported(): boolean {
    return process.platform === "darwin" && existsSync(this.helperPath);
  }

  async status(noticeAccepted: boolean): Promise<ScreenStatus> {
    if (!this.supported)
      return {
        supported: false,
        permissions: { accessibility: false, screen: false },
        noticeAccepted,
      };
    const permissions = parsePermissions(await runHelper(this.helperPath, ["permissions"]));
    return { supported: true, permissions, noticeAccepted };
  }

  openSettings(kind: keyof typeof SETTINGS_URLS): Promise<void> {
    return shell.openExternal(SETTINGS_URLS[kind]);
  }

  /** Windows the user can pick, without Poko's own windows, with small thumbnails. */
  async listWindows(): Promise<ScreenWindow[]> {
    const windows = (await this.windows()).filter((window) => window.pid !== process.pid);
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 320, height: 200 },
    });
    const thumbnails = new Map(
      sources.map((source) => [windowIdFromSource(source.id), source.thumbnail] as const),
    );
    return windows.map((window) => {
      const thumbnail = thumbnails.get(window.id);
      return {
        id: window.id,
        app: window.owner || window.bundleId || "앱",
        title: window.title,
        thumbnail: thumbnail && !thumbnail.isEmpty() ? thumbnail.toDataURL() : null,
      };
    });
  }

  /** Snapshot, capture, and prompt for one look at `windowId`. */
  async prepareLook(windowId: number, question: string): Promise<PreparedLook> {
    const window = (await this.windows()).find((candidate) => candidate.id === windowId);
    if (!window || window.pid === process.pid)
      throw new HelperError("window_not_found", "The window is no longer available.");
    const snapshot = parseSnapshot(
      await runHelper(this.helperPath, ["snapshot", String(windowId)]),
    );
    const { frame, scale } = snapshot.window;
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: {
        width: Math.round(frame.width * scale),
        height: Math.round(frame.height * scale),
      },
    });
    const image = sources.find((source) => windowIdFromSource(source.id) === windowId)?.thumbnail;
    if (!image || image.isEmpty())
      throw new HelperError("capture_failed", "Screen Recording permission is needed.");
    if (!captureMatchesWindow(image.getSize(), frame))
      throw new HelperError("capture_mismatch", "The capture does not match the window.");

    const tempDir = join(this.tempRoot, randomUUID());
    const workDir = join(tempDir, "work");
    await mkdir(workDir, { recursive: true });
    const imagePath = join(tempDir, "screen.png");
    await writeFile(imagePath, image.toPNG());
    return {
      prompt: buildLookPrompt(question, snapshot),
      imagePath,
      workDir,
      tempDir,
      app: window.owner || window.bundleId || "앱",
      snapshot,
    };
  }

  cleanup(tempDir: string): Promise<void> {
    return rm(tempDir, { recursive: true, force: true });
  }

  /** Leftover screenshots from a crash never outlive a restart. */
  cleanupAll(): Promise<void> {
    return rm(this.tempRoot, { recursive: true, force: true });
  }

  private async windows(): Promise<ScreenWindowInfo[]> {
    return parseWindows(await runHelper(this.helperPath, ["windows"]));
  }
}
