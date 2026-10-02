export const IPC_CHANNELS = {
  workspaceGet: "workspace:get",
  workspaceSelect: "workspace:select",
  taskStart: "task:start",
  conversationOpen: "conversation:open",
  taskCancel: "task:cancel",
  taskEvent: "task:event",
  appBootstrap: "app:bootstrap",
  memoryList: "memory:list",
  memorySearch: "memory:search",
  memorySave: "memory:save",
  memoryDelete: "memory:delete",
  approvalRespond: "approval:respond",
  screenStatus: "screen:status",
  screenOpenSettings: "screen:open-settings",
  screenAcceptNotice: "screen:accept-notice",
  screenListWindows: "screen:list-windows",
  screenLook: "screen:look",
  screenAct: "screen:act",
  overlayScene: "overlay:scene",
  overlayHide: "overlay:hide",
} as const;

/** What the on-screen Poko shows: frames are in points, relative to its display. */
export interface OverlayScene {
  display: { width: number; height: number };
  /** The picked window; Poko starts from its corner. */
  origin: { x: number; y: number; width: number; height: number };
  points: { frame: { x: number; y: number; width: number; height: number }; say: string }[];
}

export interface ScreenStatus {
  /** macOS with the helper built. */
  supported: boolean;
  permissions: { accessibility: boolean; screen: boolean };
  /** The user has read what a screen task sends to Codex. */
  noticeAccepted: boolean;
}

/** A screen look either starts a task or explains, in plain words, why it couldn't. */
/** A started task, with the conversation it belongs to (new or existing). */
export type ScreenLookResponse =
  | { taskId: string; conversation: PersistedConversation }
  | { error: string };

export interface ScreenWindow {
  id: number;
  app: string;
  title: string;
  /** Small PNG data URL, or null without Screen Recording permission. */
  thumbnail: string | null;
  /** A supported browser, so Poko may act in its web pages (one approved step at a time). */
  canAct: boolean;
}

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

export interface AgentTask {
  id: string;
  prompt: string;
  cwd: string;
  mode: "read" | "write";
  /**
   * `project` reads the selected workspace. `screen` reads nothing from disk except its empty
   * temp folder, and Codex's shell is turned off.
   */
  profile?: "project" | "screen";
  /** Local image files attached to the prompt (screenshots). */
  images?: string[];
}

export type AgentEvent =
  | { type: "started" }
  | { type: "thinking"; message?: string }
  | { type: "tool"; tool: string; detail?: string }
  /** `itemId` groups deltas by agent message, so the UI can replace text when a new message starts. */
  | { type: "output"; content: string; itemId?: string }
  | { type: "completed"; result: string }
  | { type: "cancelled" }
  | {
      type: "approvalRequired";
      requestId: string;
      kind: ApprovalKind;
      summary: string;
      cwd: string | null;
      reason: string | null;
      diff?: Array<{ path: string; change: string }>;
      /** For `screen_action`: what will happen, with a crop of the target as the evidence. */
      screen?: ScreenActionPreview;
      canApprove: boolean;
    }
  | { type: "error"; error: string };

export type ApprovalKind = "command" | "file_change" | "screen_action";

export interface ScreenActionPreview {
  action: "click" | "type" | "reveal";
  /** PNG data URL of the target, cut from the window capture. */
  crop: string;
  /** The element's (untrusted) name. */
  target: string;
  /** For `type`: the full text that will be entered. */
  text?: string;
  /** Set when the target looks like paying, deleting, or sending. */
  warning?: string;
}

export type ApprovalChoice = "approve" | "decline";
/**
 * What happened to an approval response: applied as chosen, turned into a decline because the
 * change is no longer safe to approve, or ignored because the request is gone.
 */
export type ApprovalOutcome = "applied" | "declined_unsafe" | "stale";
export interface ApprovalRequest {
  taskId: string;
  requestId: string;
  kind: ApprovalKind;
  summary: string;
  cwd: string | null;
  reason: string | null;
  diff?: Array<{ path: string; change: string }>;
  canApprove: boolean;
}

export interface TaskEventPayload {
  taskId: string;
  event: AgentEvent;
}

export type TaskStartResponse = ScreenLookResponse;

export interface PersistedConversation {
  id: string;
  title: string;
  updatedAt: string;
}

export interface PersistedMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}
export interface PersistedTask {
  id: string;
  title: string;
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
  createdAt: string;
  completedAt: string | null;
}
export interface PersistedActivity {
  id: string;
  taskId: string;
  taskTitle: string;
  type: string;
  message: string;
  createdAt: string;
}
export interface PersistedMemory {
  id: string;
  type: "preference" | "project" | "person" | "decision" | "fact" | "routine";
  content: string;
  importance: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}
export interface AppBootstrap {
  workspace: WorkspaceInfo | null;
  /** The conversation shown at start, or null for the greeting screen. */
  conversationId: string | null;
  conversations: PersistedConversation[];
  messages: PersistedMessage[];
  tasks: PersistedTask[];
  activities: PersistedActivity[];
}
export interface MemoryInput {
  type: PersistedMemory["type"];
  content: string;
  importance: number;
}
