export const IPC_CHANNELS = {
  workspaceGet: "workspace:get",
  workspaceSelect: "workspace:select",
  taskStart: "task:start",
  conversationOpen: "conversation:open",
  setupStatus: "setup:status",
  setupClaudeStatus: "setup:claude-status",
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
  conversationSearch: "conversation:search",
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
  modelsList: "models:list",
  quickAsk: "quick:ask",
  quickHide: "quick:hide",
  quickOpenInApp: "quick:open-in-app",
  /** The panel's content height, so the window never covers more than the panel. */
  quickResize: "quick:resize",
  /** The panel's yes or no to its answer's memory suggestion. */
  quickRemember: "quick:remember",
  /** Starts macOS Dictation in the focused text field of the asking window. */
  dictationStart: "dictation:start",
  /** main → quick panel: what the panel shows. */
  quickState: "quick:state",
  /** The running task and its pending approval cards, for a main window that just opened. */
  taskActive: "task:active",
  /** main → main window: a task started elsewhere (the quick panel). */
  taskStarted: "task:started",
  /** main → main window: show this conversation (and adopt its running task). */
  appFocusConversation: "app:focus-conversation",
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
  /** The model the user picked for this engine; absent means the CLI's default. */
  model?: string;
  /**
   * The engine this task must run on, fixed when it was checked (a screen task's data notice
   * is accepted per engine); absent means the engine chosen when it starts.
   */
  engine?: EngineId;
  /** The reasoning effort the user picked for this engine; absent means the CLI's default. */
  effort?: ReasoningEffort;
}

export type AgentEvent =
  | { type: "started" }
  | { type: "thinking"; message?: string }
  | { type: "tool"; tool: string; detail?: string }
  /** `itemId` groups deltas by agent message, so the UI can replace text when a new message starts. */
  | { type: "output"; content: string; itemId?: string }
  /** `memory`: something the answer suggests remembering; saved only if the user agrees. */
  | { type: "completed"; result: string; memory?: MemorySuggestion }
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

/** The CLI that runs conversations and edits. Screen tasks always use Codex. */
export type EngineId = "codex" | "claude";

/** Whether the user's Claude Code CLI can run Poko's tasks. */
export interface ClaudeSetup {
  installed: boolean;
  path: string | null;
  version: string | null;
  /** How `claude auth status` reports the sign-in; Poko never sees a key or token. */
  login: "signed_in" | "signed_out" | "unknown";
  /** The options Poko relies on (stream-json, safe mode, setting sources) are present. */
  featuresOk: boolean;
  ready: boolean;
}

/** Preferences on the 설정 page. */
export interface AppSettings {
  engine: EngineId;
  /** The global shortcut that opens the quick panel. */
  quickShortcut: QuickShortcut;
  /** The model per engine; null uses the CLI's default. */
  codexModel: string | null;
  claudeModel: string | null;
  /** The reasoning effort per engine; null uses the CLI's (or model's) default. */
  codexEffort: ReasoningEffort | null;
  claudeEffort: ReasoningEffort | null;
  /** Saved memories go with each request. */
  memoriesInContext: boolean;
  /** A macOS notification when a task ends or waits for approval while Poko isn't in front. */
  taskNotifications: boolean;
  checkpointDays: CheckpointDays;
}

export interface SettingsView {
  settings: AppSettings;
  version: string;
  /** False when another app already owns the chosen shortcut. */
  quickShortcutOk: boolean;
}

/** The word the user types to confirm 모든 데이터 삭제. */
export const DELETE_ALL_CONFIRMATION = "삭제";

export type DataExportResult = "saved" | "cancelled" | "failed";

/** After deleting everything, the fresh start data, so the renderer can reset every page. */
export type DeleteAllResponse = { ok: true; bootstrap: AppBootstrap } | { error: string };

/** A model the user can pick for an engine. */
export interface ModelOption {
  id: string;
  label: string;
  /** The CLI's default model. */
  isDefault?: boolean;
  /** Reasoning efforts this model accepts, when the CLI says; absent means all. */
  efforts?: ReasoningEffort[];
}

/**
 * Model names are short identifiers (`gpt-6-astra`, `opus`, `openai/gpt-oss-120b`); anything
 * else is ignored. The first character is never `-`, so a name can't read as a CLI option.
 */
export function isModelName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/@\-[\]]{0,119}$/.test(value);
}

/** Whether an error says the picked model doesn't exist or the account can't use it. */
export function isUnavailableModelError(text: string): boolean {
  return (
    /model/i.test(text) &&
    /not found|does not exist|no access|do not have access|don't have access|invalid model|unknown model|model is not supported|not supported when using/i.test(
      text,
    )
  );
}

export const QUICK_SHORTCUTS = ["Alt+Space", "Alt+Shift+Space", "off"] as const;
export type QuickShortcut = (typeof QUICK_SHORTCUTS)[number];

/** What the quick panel shows: its latest question and a reduced view of its task. */
export interface QuickState {
  phase: "idle" | "running" | "approval" | "done" | "error";
  question: string;
  /** The answer so far (streamed), or the final answer. */
  answer: string;
  /** A short status or a plain error. */
  message: string | null;
  conversationId: string | null;
  taskId: string | null;
  /** The window that was in front when the panel opened, which the question can include. */
  screen: { app: string; title: string } | null;
  /** Why the window can't be included right now (permissions, notice), or null. */
  screenHint: string | null;
  /** Counts openings, so the panel resets "include the screen" each time it opens. */
  opened: number;
  /** A memory the panel's answer suggested; main keeps it and saves it only on yes. */
  memory: MemorySuggestion | null;
}

/** The running task, for a main window that opens while it runs. */
export interface ActiveTaskInfo {
  taskId: string;
  conversationId: string | null;
  approvals: PendingApprovalEvent[];
  /** The answer written so far, so a window taking the task over doesn't start mid-sentence. */
  answer?: { text: string; itemId: string | null };
}

/** An approval card as the renderer shows it. */
export type PendingApprovalEvent = Extract<AgentEvent, { type: "approvalRequired" }> & {
  taskId: string;
};

/** A task started outside the main window, so its lists stay in sync. */
export interface TaskStartedNotice {
  taskId: string;
  title: string;
  conversation: PersistedConversation;
}

/** A file the user dropped into the message box: its content, never a path. */
export interface ChatAttachment {
  kind: "image" | "text";
  name: string;
  mediaType: string;
  /** Base64 for an image, the text itself for a text file. */
  data: string;
}

/** Limits for attached files, shared by the message box and main. */
export const ATTACHMENT_LIMITS = {
  count: 5,
  /** Raw bytes per image: as base64 it stays under Claude's 5 MB per image. */
  imageBytes: 3.5 * 1024 * 1024,
  /** Raw bytes of all images together: as base64 well under a 32 MB request. */
  totalImageBytes: 15 * 1024 * 1024,
  textChars: 200_000,
} as const;

/** A file name for display: no folders, control characters, or backticks; short. */
export function cleanAttachmentName(value: unknown): string {
  const name = typeof value === "string" ? value : "";
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = [...base]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f && char !== "`";
    })
    .join("")
    .trim()
    .slice(0, 120);
  return clean || "첨부 파일";
}

/**
 * Reasoning efforts both engines take. Codex's "ultra" isn't offered: it hands work to
 * sub-agents, which Poko keeps off.
 */
export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly unknown[]).includes(value);
}

/** A conversation that matches a search, with where its messages matched. */
export interface ConversationMatch extends PersistedConversation {
  /** A short piece of the newest message that matched, or null when only the title did. */
  snippet: string | null;
}

/** A memory the engine suggested from the conversation; the user decides whether to keep it. */
export interface MemorySuggestion {
  type: MemoryInput["type"];
  content: string;
}

const MEMORY_LINE =
  /^<poko-memory\s+type="(preference|project|person|decision|fact|routine)">([\s\S]*?)<\/poko-memory>\s*$/;

/** The answer before its last line, and that line, when the line starts a memory tag. */
function trailingTag(answer: string): { text: string; line: string } | null {
  const trimmed = answer.trimEnd();
  const lineStart = trimmed.lastIndexOf("\n") + 1;
  const line = trimmed.slice(lineStart).trim();
  return line.startsWith("<poko-memory")
    ? { text: trimmed.slice(0, lineStart).trimEnd(), line }
    : null;
}

/**
 * Splits an answer into the text to show and an optional memory suggestion. The engine is
 * asked to put `<poko-memory type="…">…</poko-memory>` on the answer's **last line**; only
 * that line counts and is removed. A tag quoted anywhere else (from a file, say) stays in the
 * text as it is and is never taken as a suggestion.
 */
export function takeMemorySuggestion(answer: string): {
  text: string;
  memory: MemorySuggestion | null;
} {
  const tail = trailingTag(answer);
  if (!tail) return { text: answer, memory: null };
  const match = MEMORY_LINE.exec(tail.line);
  const content = match?.[2].replace(/\s+/g, " ").trim() ?? "";
  return {
    text: tail.text,
    memory:
      match && content && content.length <= 300
        ? { type: match[1] as MemorySuggestion["type"], content }
        : null,
  };
}

/**
 * Streaming text without the memory tag line, by the same last-line rule as
 * takeMemorySuggestion, including a line still being written ("<pok…").
 */
export function hideMemoryTag(text: string): string {
  const lineStart = text.lastIndexOf("\n") + 1;
  const line = text.slice(lineStart).trimStart();
  const writing =
    line.length > 0 && ("<poko-memory".startsWith(line) || line.startsWith("<poko-memory"));
  return writing ? text.slice(0, lineStart).trimEnd() : text;
}
