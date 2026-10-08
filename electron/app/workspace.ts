import { dialog, ipcMain } from "electron";
import { resolveWorkspaceDirectory } from "../agent/workspace";
import { isFolderPath } from "../database/Database";
import { FOLDER_MEMORY_TYPES, IPC_CHANNELS, type MemoryInput } from "../shared";
import {
  anyTaskBusy,
  bootstrapData,
  conversationFolder,
  ctx,
  folderGoneMessage,
  isTrustedRenderer,
  workspaceInfo,
} from "./context";

/**
 * The folder a memory is saved in: null for shared types. A suggestion's memory belongs to the
 * folder of the task that suggested it (shared for a screen task); one typed on the 기억 page
 * belongs to the selected folder, and is refused rather than quietly shared without one.
 */
export async function memoryFolder(
  type: MemoryInput["type"],
  fromTaskId: unknown,
): Promise<string | null | { error: string }> {
  if (!FOLDER_MEMORY_TYPES.includes(type) || !ctx.database) return null;
  if (typeof fromTaskId === "string" && fromTaskId.length <= 100) {
    const folder = suggestionFolder(type, fromTaskId);
    return folder === "gone"
      ? { error: "이 기억을 제안한 작업이 지워져서 어느 폴더 것인지 알 수 없어." }
      : folder;
  }
  const saved = ctx.database.getWorkspace();
  if (!saved) return { error: "프로젝트나 결정 기억은 폴더에 속해. 먼저 작업할 폴더를 선택해 줘." };
  const selected = await resolveWorkspaceDirectory(saved).catch(() => null);
  return selected ?? { error: "선택한 작업 폴더를 찾지 못했어. 폴더를 다시 선택해 줘." };
}

/**
 * The folder a suggested memory belongs to: the suggesting task's folder for 프로젝트 and 결정
 * (null, shared, for a screen task or another type), or "gone" when that task no longer
 * exists. Saving and the suggestion filter both use it, so they never disagree.
 */
export function suggestionFolder(
  type: MemoryInput["type"],
  taskId: string,
): string | null | "gone" {
  if (!FOLDER_MEMORY_TYPES.includes(type) || !ctx.database) return null;
  if (!ctx.database.hasTask(taskId)) return "gone";
  const folder = ctx.database.getTaskWorkspace(taskId);
  return isFolderPath(folder) ? folder : null;
}

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
    // The folder as checked just now, so a link changed later can't point elsewhere.
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
  ipcMain.handle(IPC_CHANNELS.memorySave, async (event, rawInput: unknown) => {
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
    const type = input.type as MemoryInput["type"];
    const scope = await memoryFolder(type, input.fromTaskId);
    if (typeof scope === "object" && scope !== null) return scope;
    return ctx.database.saveMemory(
      { type, content: input.content, importance: input.importance as number },
      scope,
    );
  });
  ipcMain.handle(IPC_CHANNELS.memoryUpdate, (event, rawId: unknown, rawContent: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer requested memory update.");
    if (
      typeof rawId !== "string" ||
      rawId.length > 100 ||
      typeof rawContent !== "string" ||
      !rawContent.trim() ||
      rawContent.length > 4000
    )
      return { error: "기억 내용을 다시 확인해 줘." };
    const updated = ctx.database.updateMemory(rawId, rawContent);
    if (updated === "duplicate") return { error: "같은 내용의 기억이 이미 있어." };
    if (!updated) return { error: "이 기억을 찾을 수 없어." };
    return updated;
  });

  ipcMain.handle(IPC_CHANNELS.memoryDelete, (event, rawId: unknown) => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer requested memory delete.");
    if (typeof rawId !== "string" || rawId.length > 100) throw new TypeError("Invalid memory id.");
    return ctx.database.deleteMemory(rawId);
  });
}
