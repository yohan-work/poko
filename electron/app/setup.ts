import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../shared";
import { ctx, isTrustedRenderer } from "./context";

/** The Codex setup check and sign-in. */
export function registerSetupHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.setupStatus, async (event) => {
    if (!isTrustedRenderer(event) || !ctx.setupService)
      throw new Error("Unknown renderer asked for setup.");
    return ctx.setupService.refresh();
  });

  ipcMain.handle(IPC_CHANNELS.setupClaudeStatus, async (event) => {
    if (!isTrustedRenderer(event) || !ctx.claudeSetup)
      throw new Error("Unknown renderer asked for Claude Code setup.");
    return ctx.claudeSetup.refresh();
  });

  ipcMain.handle(IPC_CHANNELS.setupLogin, (event) => {
    if (!isTrustedRenderer(event) || !ctx.setupService)
      throw new Error("Unknown renderer started a login.");
    return ctx.setupService.startLogin();
  });

  ipcMain.handle(IPC_CHANNELS.setupCancelLogin, (event) => {
    if (!isTrustedRenderer(event) || !ctx.setupService)
      throw new Error("Unknown renderer cancelled a login.");
    ctx.setupService.cancelLogin();
    return true;
  });
}
