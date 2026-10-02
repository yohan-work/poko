import { dialog, ipcMain } from "electron";
import { IPC_CHANNELS, type MemoryInput } from "../shared";
import { ctx, isTrustedRenderer, workspaceInfo } from "./context";

/** Workspace, app data, and memories. */
export function registerWorkspaceHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.workspaceGet, async (event) => {
    if (!isTrustedRenderer(event)) {
      throw new Error("Unknown renderer requested the workspace.");
    }

    return workspaceInfo(ctx.database?.getWorkspace() ?? null);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceSelect, async (event) => {
    if (!isTrustedRenderer(event) || !ctx.mainWindow) {
      throw new Error("Unknown renderer requested workspace selection.");
    }

    const parentWindow = ctx.mainWindow;
    const currentPath = ctx.database?.getWorkspace() ?? null;
    const selection = await dialog.showOpenDialog(parentWindow, {
      title: "작업할 폴더 선택",
      defaultPath: currentPath ?? undefined,
      properties: ["openDirectory"],
    });

    if (selection.canceled || selection.filePaths.length === 0) return null;

    const [selectedPath] = selection.filePaths;
    ctx.database?.setWorkspace(selectedPath);
    return workspaceInfo(selectedPath);
  });

  ipcMain.handle(IPC_CHANNELS.appBootstrap, (event) => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer requested app data.");
    const { workspacePath, ...data } = ctx.database.getBootstrapData();
    return { ...data, workspace: workspaceInfo(workspacePath) };
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
