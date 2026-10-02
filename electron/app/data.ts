import { app, dialog, ipcMain, shell } from "electron";
import { join } from "node:path";
import { localDate, writePrivateFile } from "../data/privateFile";
import {
  type DataExportResult,
  DELETE_ALL_CONFIRMATION,
  type DeleteAllResponse,
  IPC_CHANNELS,
} from "../shared";
import { anyTaskBusy, bootstrapData, ctx, isTrustedRenderer } from "./context";

/** 모두 내보내기, 데이터 폴더 열기, and 모든 데이터 삭제. */
export function registerDataHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.dataExport, async (event): Promise<DataExportResult> => {
    if (!isTrustedRenderer(event) || !ctx.database || !ctx.mainWindow)
      throw new Error("Unknown renderer requested an export.");
    const choice = await dialog.showSaveDialog(ctx.mainWindow, {
      title: "포코 데이터 내보내기",
      defaultPath: join(app.getPath("downloads"), `poko-export-${localDate()}.json`),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (choice.canceled || !choice.filePath) return "cancelled";
    try {
      const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        ...ctx.database.exportAll(),
      };
      await writePrivateFile(choice.filePath, `${JSON.stringify(data, null, 2)}\n`);
      return "saved";
    } catch (error) {
      console.error("Could not export data.", error);
      return "failed";
    }
  });

  ipcMain.handle(IPC_CHANNELS.dataOpenFolder, async (event) => {
    if (!isTrustedRenderer(event)) throw new Error("Unknown renderer opened the data folder.");
    return (await shell.openPath(app.getPath("userData"))) === "";
  });

  ipcMain.handle(
    IPC_CHANNELS.dataDeleteAll,
    async (event, raw: unknown): Promise<DeleteAllResponse> => {
      if (!isTrustedRenderer(event) || !ctx.database)
        throw new Error("Unknown renderer requested deleting all data.");
      const confirmation =
        typeof raw === "object" && raw !== null ? (raw as { confirm?: unknown }).confirm : null;
      if (confirmation !== DELETE_ALL_CONFIRMATION)
        return { error: `확인을 위해 "${DELETE_ALL_CONFIRMATION}"를 입력해 줘.` };
      if (ctx.deletingData || anyTaskBusy())
        return { error: "포코가 작업 중이라 지금은 지울 수 없어. 작업이 끝난 뒤 다시 시도해 줘." };
      ctx.deletingData = true;
      try {
        ctx.database.deleteAllHistory();
        await ctx.editManager?.forgetAll();
        await ctx.screenService?.cleanupAll();
        return { ok: true, bootstrap: bootstrapData() };
      } catch (error) {
        console.error("Could not delete all data.", error);
        return { error: "데이터를 모두 지우지 못했어. 다시 시도해 줘." };
      } finally {
        ctx.deletingData = false;
      }
    },
  );
}
