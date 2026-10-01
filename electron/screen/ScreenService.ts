import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { desktopCapturer, shell } from "electron";
import type { ScreenStatus, ScreenWindow } from "../shared";
import type { Capture } from "./ScreenAgent";
import {
  type ActRequest,
  HelperError,
  parseActResult,
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

/** Browsers the helper may act in (it checks again itself). Others are look-only. */
const ACT_BROWSERS = new Set([
  "com.apple.Safari",
  "com.google.Chrome",
  "company.thebrowser.Browser",
  "org.mozilla.firefox",
  "com.microsoft.edgemac",
]);

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
        canAct: window.bundleId !== null && ACT_BROWSERS.has(window.bundleId),
      };
    });
  }

  /** Snapshot, capture, and prompt for one look at `windowId`. */
  async prepareLook(windowId: number, question: string): Promise<PreparedLook> {
    const capture = await this.capture(windowId);
    return {
      prompt: buildLookPrompt(question, capture.snapshot),
      imagePath: capture.imagePath,
      workDir: capture.workDir,
      tempDir: capture.tempDir,
      app: capture.app,
      snapshot: capture.snapshot,
    };
  }

  /**
   * The window's accessibility snapshot and a full-scale capture, saved to a fresh temp folder
   * with an empty work folder beside it. `release` removes both.
   */
  async capture(windowId: number): Promise<Capture & { tempDir: string; app: string }> {
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
    const imageSize = image.getSize();
    if (!captureMatchesWindow(imageSize, frame))
      throw new HelperError("capture_mismatch", "The capture does not match the window.");

    const tempDir = join(this.tempRoot, randomUUID());
    const workDir = join(tempDir, "work");
    await mkdir(workDir, { recursive: true });
    const imagePath = join(tempDir, "screen.png");
    await writeFile(imagePath, image.toPNG());
    return {
      snapshot,
      imagePath,
      workDir,
      tempDir,
      imageSize,
      // Aspect-preserving, so the comparison isn't distorted; the area around the target is
      // compared at full size separately.
      fingerprint: new Uint8Array(image.resize({ width: 320 }).toBitmap()),
      app: window.owner || window.bundleId || "앱",
      crop: (rect) => {
        const part = image.crop(rect);
        return { dataUrl: part.toDataURL(), bitmap: new Uint8Array(part.toBitmap()) };
      },
      release: () => this.cleanup(tempDir),
    };
  }

  /** Brings the window in front, so another app's window doesn't cover what Poko looks at. */
  async raise(windowId: number): Promise<void> {
    parseActResult(await runHelper(this.helperPath, ["raise", String(windowId)]));
  }

  /** Runs the helper's `act` for one request; throws HelperError when a check refuses. */
  async act(windowId: number, request: ActRequest): Promise<{ valueMatches?: boolean }> {
    return parseActResult(
      await runHelper(this.helperPath, ["act", String(windowId)], 8000, JSON.stringify(request)),
    );
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
