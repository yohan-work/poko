import { dialog, ipcMain } from "electron";
import { IPC_CHANNELS, type MemoryInput } from "../shared";
import {
  anyTaskBusy,
  bootstrapData,
  conversationFolder,
  ctx,
  folderGoneMessage,
  isTrustedRenderer,
  workspaceInfo,
} from "./context";

const FOLDER_BUSY = "포코가 작업 중이라 지금은 폴더를 바꿀 수 없어. 끝난 뒤에 다시 해 줘.";

/** Workspace, app data, and memories. */
export function registerWorkspaceHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.workspaceGet, async (event) => {
    if (!isTrustedRenderer(event)) {
      throw new Error("Unknown renderer requested the workspace.");
    }

    return await workspaceInfo(ctx.database?.getWorkspace() ?? null);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceSelect, async (event) => {
    if (!isTrustedRenderer(event) || !ctx.mainWindow) {
      throw new Error("Unknown renderer requested workspace selection.");
    }

    // A task resolves the folder when it starts; changing it mid-task would mix two folders.
    if (anyTaskBusy() || ctx.deletingData) return { error: FOLDER_BUSY };
    const parentWindow = ctx.mainWindow;
    const currentPath = ctx.database?.getWorkspace() ?? null;
    const selection = await dialog.showOpenDialog(parentWindow, {
      title: "작업할 폴더 선택",
      defaultPath: currentPath ?? undefined,
      properties: ["openDirectory"],
    });

    if (selection.canceled || selection.filePaths.length === 0) return null;

    const [selectedPath] = selection.filePaths;
    // A task may have started while the dialog was open.
    if (anyTaskBusy() || ctx.deletingData) return { error: FOLDER_BUSY };
    ctx.database?.setWorkspace(selectedPath);
    return await workspaceInfo(selectedPath);
  });

  // 폴더로 바꾸기: the folder a conversation works in, which main stored; no path comes in.
  ipcMain.handle(IPC_CHANNELS.workspaceUseConversationFolder, async (event, raw: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer asked to change the folder.");
    if (anyTaskBusy() || ctx.deletingData) return { error: FOLDER_BUSY };
    const found =
      typeof raw === "string" && raw.length <= 100 ? await conversationFolder(raw) : null;
    if (!found) return { error: "이 대화의 폴더를 알 수 없어." };
    if (!found.resolved) return { error: folderGoneMessage(found.folder), gone: true };
    // Checked again: a task may have started while the folder was being resolved.
    if (anyTaskBusy() || ctx.deletingData) return { error: FOLDER_BUSY };
    // The resolved path, so it compares equal with the conversation's folder from now on.
    ctx.database.setWorkspace(found.resolved);
    return { workspace: await workspaceInfo(found.resolved) };
  });

  ipcMain.handle(IPC_CHANNELS.appBootstrap, async (event) => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer requested app data.");
    return await bootstrapData();
  });
  ipcMain.handle(IPC_CHANNELS.memoryList, (event) => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer requested memories.");
    return ctx.database.listMemories();
  });
  ipcMain.handle(IPC_CHANNELS.memorySearch, (event, rawQuery: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer requested memories.");
    if (typeof rawQuery !== "string" || rawQuery.length > 500)
      throw new TypeError("Invalid search query.");
    return rawQuery.trim()
      ? ctx.database.searchMemories(rawQuery.trim())
      : ctx.database.listMemories();
  });
  ipcMain.handle(IPC_CHANNELS.memorySave, (event, rawInput: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.database)
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
    return ctx.database.saveMemory({
      type: input.type as MemoryInput["type"],
      content: input.content,
      importance: input.importance as number,
    });
  });
  ipcMain.handle(IPC_CHANNELS.memoryDelete, (event, rawId: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer requested memory delete.");
    if (typeof rawId !== "string" || rawId.length > 100) throw new TypeError("Invalid memory id.");
    return ctx.database.deleteMemory(rawId);
  });
}
