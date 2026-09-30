import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type ConversationReply, type WorkspaceInfo } from "./shared";

const pokoApi = {
  workspace: {
    get: (): Promise<WorkspaceInfo | null> => ipcRenderer.invoke(IPC_CHANNELS.workspaceGet),
    select: (): Promise<WorkspaceInfo | null> => ipcRenderer.invoke(IPC_CHANNELS.workspaceSelect),
  },
  conversation: {
    send: (message: string): Promise<ConversationReply> =>
      ipcRenderer.invoke(IPC_CHANNELS.conversationSend, message),
  },
};

contextBridge.exposeInMainWorld("poko", pokoApi);

export type PokoApi = typeof pokoApi;
