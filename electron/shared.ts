export const IPC_CHANNELS = {
  workspaceGet: "workspace:get",
  workspaceSelect: "workspace:select",
  taskStart: "task:start",
  conversationOpen: "conversation:open",
  setupStatus: "setup:status",
  setupLogin: "setup:login",
  setupCancelLogin: "setup:cancel-login",
  /** main → renderer: the setup changed (a login finished). */
  setupChanged: "setup:changed",
  editsGet: "edits:get",
  editsSet: "edits:set",
  editsList: "edits:list",
  editsUndo: "edits:undo",
  /** main → renderer: a conversation's edits changed (settled or undone). */
  editsChanged: "edits:changed",
  conversationRename: "conversation:rename",
  conversationDelete: "conversation:delete",
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
  screenResetNotice: "screen:reset-notice",
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  dataExport: "data:export",
  dataOpenFolder: "data:open-folder",
  dataDeleteAll: "data:delete-all",
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

export type AppView = "conversation" | "memory" | "tasks" | "activity" | "settings";

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
  /** The user turned on edits for this workspace; otherwise every file change is declined. */
  editsEnabled?: boolean;
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

/** An approved change shown in its conversation, with undo while it is still possible. */
export interface EditNote {
  id: string;
  createdAt: string;
  /** Paths relative to the workspace. */
  files: string[];
  status: "applied" | "undone" | "expired";
}

/** The Codex setup Poko depends on, checked on first run and from the setup screen. */
export interface CodexSetup {
  installed: boolean;
  path: string | null;
  version: string | null;
  /** `codex` is a node script and no `node` was found to start it. */
  missingNode: boolean;
  /** How this Codex was installed, so the update hint matches it. */
  source?: "homebrew" | "npm";
  login: "chatgpt" | "api_key" | "signed_out" | "unknown";
  /** Version and features are new enough. */
  featuresOk: boolean;
  ready: boolean;
  /** A `codex login` started from Poko is still open. */
  loggingIn?: boolean;
}

export interface EditsState {
  /** A workspace is selected. */
  available: boolean;
  enabled: boolean;
  /** After turning edits off: the pending file changes that were declined. */
  declined?: Array<{ taskId: string; requestId: string }>;
}

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

/** How long undo data for approved changes is kept, in days. */
export const CHECKPOINT_DAY_CHOICES = [7, 30, 90] as const;
export type CheckpointDays = (typeof CHECKPOINT_DAY_CHOICES)[number];

/** Preferences on the 설정 page. */
export interface AppSettings {
  /** Saved memories go with each request. */
  memoriesInContext: boolean;
  checkpointDays: CheckpointDays;
}

export interface SettingsView {
  settings: AppSettings;
  version: string;
}

/** The word the user types to confirm 모든 데이터 삭제. */
export const DELETE_ALL_CONFIRMATION = "삭제";

export type DataExportResult = "saved" | "cancelled" | "failed";

/** After deleting everything, the fresh start data, so the renderer can reset every page. */
export type DeleteAllResponse = { ok: true; bootstrap: AppBootstrap } | { error: string };
