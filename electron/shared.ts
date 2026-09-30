export const IPC_CHANNELS = {
  workspaceGet: "workspace:get",
  workspaceSelect: "workspace:select",
  conversationSend: "conversation:send",
} as const;

export type CharacterState =
  | "idle"
  | "listening"
  | "thinking"
  | "working"
  | "success"
  | "error"
  | "approval";

export type AppView = "conversation" | "memory" | "tasks" | "activity";

export interface WorkspaceInfo {
  path: string;
  name: string;
}

export interface ConversationReply {
  content: string;
}
