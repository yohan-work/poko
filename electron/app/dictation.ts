import { BrowserWindow, ipcMain } from "electron";
import { IPC_CHANNELS } from "../shared";
import { ctx, isQuickPanel, isTrustedRenderer } from "./context";

/**
 * Voice input through macOS Dictation. AppKit puts Start Dictation in the Edit menu, and
 * pressing it starts Dictation in the focused text field. Electron can't send that action
 * itself, so the helper presses Poko's own menu item (Accessibility, already used by screen
 * tasks). Dictation runs on the Mac; Poko records nothing.
 */
export function registerDictationHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.dictationStart, async (event) => {
    if (!isTrustedRenderer(event) && !isQuickPanel(event))
      throw new Error("Unknown sender started dictation.");
    if (!ctx.screenService?.supported) return false;
    BrowserWindow.fromWebContents(event.sender)?.focus();
    try {
      await ctx.screenService.dictate();
      return true;
    } catch (error) {
      console.error("Could not start Dictation.", error);
      return false;
    }
  });
}
