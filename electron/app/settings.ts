import { app, ipcMain } from "electron";
import { type AppSettings, IPC_CHANNELS, type SettingsView } from "../shared";
import { ctx, isTrustedRenderer } from "./context";

/** The 설정 page: preferences and the app version. */
export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.settingsGet, (event): SettingsView => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer requested settings.");
    return { settings: ctx.database.getSettings(), version: app.getVersion() };
  });

  ipcMain.handle(IPC_CHANNELS.settingsSet, (event, raw: unknown): AppSettings => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer changed settings.");
    const input = typeof raw === "object" && raw !== null ? (raw as Partial<AppSettings>) : {};
    return ctx.database.setSettings({
      engine: input.engine,
      memoriesInContext: input.memoriesInContext,
      checkpointDays: input.checkpointDays,
    });
  });
}
