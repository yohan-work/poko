import type {
  ApprovalChoice,
  AppSettings,
  AppView,
  CharacterState,
  ChatAttachment,
  ClaudeSetup,
  CodexSetup,
  DataExportResult,
  EditNote,
  EditsState,
  EngineId,
  MemoryInput,
  MemorySuggestion,
  ModelOption,
  PendingApprovalEvent,
  PersistedConversation,
  PersistedMemory,
  ScreenStatus,
  ScreenWindow,
  WorkspaceInfo,
} from "../../../../electron/shared";
import type { StreamingAnswer } from "../lib/streaming";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  taskId: string;
  taskTitle?: string;
  message: string;
  createdAt: string;
}

export type PendingApproval = PendingApprovalEvent;

export interface ScreenState {
  open: boolean;
  loading: boolean;
  status: ScreenStatus | null;
  windows: ScreenWindow[];
  error: string | null;
}

export interface SessionTask {
  id: string;
  title: string;
  status: "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
  createdAt: string;
  completedAt?: string;
}

/** Codex and Claude Code setup, and each engine's models. */
export interface SetupSlice {
  setup: CodexSetup | null;
  claudeSetup: ClaudeSetup | null;
  setupChecking: boolean;
  setupDismissed: boolean;
  checkSetup: () => Promise<void>;
  startLogin: () => Promise<void>;
  cancelLogin: () => Promise<void>;
  dismissSetup: () => void;
  /** A login finished or another change arrived from main. */
  receiveSetup: (setup: CodexSetup) => void;
  /** Checks Codex again from 설정, showing the setup screen if something is missing. */
  recheckSetup: () => Promise<void>;
  /** Models per engine, loaded when the picker first needs them. */
  models: Partial<Record<EngineId, ModelOption[]>>;
  loadModels: (engine: EngineId) => Promise<void>;
}

/** Preferences, the app version, and the data page. */
export interface SettingsSlice {
  settings: AppSettings | null;
  /** False when another app already owns the quick panel shortcut. */
  quickShortcutOk: boolean;
  appVersion: string | null;
  settingsError: string | null;
  /** Loads preferences and the screen permissions for 설정. */
  loadSettings: () => Promise<void>;
  updateSettings: (change: Partial<AppSettings>) => Promise<void>;
  /** Shows the screen data-use notice again before the next screen task. */
  resetScreenNotice: () => Promise<void>;
  exportData: () => Promise<DataExportResult>;
  openDataFolder: () => Promise<void>;
  /** Deletes all history; resolves an error message, or null when every page was reset. */
  deleteAllData: (confirm: string) => Promise<string | null>;
}

/** Approved file changes: the folder's switch and this conversation's notes. */
export interface EditsSlice {
  edits: EditsState;
  /** Approved changes in the active conversation. */
  editNotes: EditNote[];
  undoingEdit: string | null;
  loadEditNotes: () => Promise<void>;
  /** Resolves to an error message, or null when undone. */
  undoEdit: (id: string) => Promise<string | null>;
  editsConfirmOpen: boolean;
  loadEdits: () => Promise<void>;
  /** Turning edits on asks first; turning them off happens at once. */
  setEdits: (enabled: boolean, confirmed?: boolean) => Promise<void>;
  closeEditsConfirm: () => void;
}

/** Saved memories and the memory the last answer suggested. */
export interface MemorySlice {
  /** A memory the last answer suggested, waiting for the user's yes or no. */
  memorySuggestion: MemorySuggestion | null;
  /** Saves the suggested memory (yes) or drops it (no). */
  answerMemorySuggestion: (keep: boolean) => Promise<void>;
  memorySuggestionError: string | null;
  savingMemorySuggestion: boolean;
  memories: PersistedMemory[];
  memoryError: string | null;
  /** The search text the memory list currently reflects. */
  memoryQuery: string;
  loadMemories: (query?: string) => Promise<void>;
  /** Resolves false when the memory could not be saved. */
  saveMemory: (input: MemoryInput) => Promise<boolean>;
  deleteMemory: (id: string) => Promise<void>;
}

/** The window picker for screen tasks. */
export interface ScreenSlice {
  screen: ScreenState;
  openScreen: () => Promise<void>;
  closeScreen: () => void;
  refreshScreen: () => Promise<void>;
  acceptScreenNotice: () => Promise<void>;
  openScreenSettings: (kind: "screen" | "accessibility") => void;
  /** Resolves true when the look started, so the caller can clear the draft. */
  lookAtWindow: (windowId: number, question: string) => Promise<boolean>;
  /** Starts a step-by-step task in a browser window; each step waits for approval. */
  actInWindow: (windowId: number, goal: string) => Promise<boolean>;
}

/** Conversations, the folder, and the task the window shows: messages, stream, and cards. */
export interface ConversationSlice {
  conversations: PersistedConversation[];
  /** null: a new conversation, created when its first message is sent. */
  activeConversationId: string | null;
  conversationError: string | null;
  newConversation: () => Promise<void>;
  openConversation: (id: string) => Promise<void>;
  /** Resolves to an error message, or null when renamed. */
  renameConversation: (id: string, title: string) => Promise<string | null>;
  deleteConversation: (id: string) => Promise<string | null>;
  activeView: AppView;
  characterState: CharacterState;
  isSending: boolean;
  isSelectingWorkspace: boolean;
  messages: ConversationMessage[];
  activities: ActivityEntry[];
  tasks: SessionTask[];
  activeTaskId: string | null;
  /** The answer being written for the active task; replaced by the saved result when it completes. */
  streaming: StreamingAnswer | null;
  /** Oldest first; Codex may ask again before the user answers. */
  pendingApprovals: PendingApproval[];
  /** A task started elsewhere (the quick panel) is running, so this window can't start one. */
  busyElsewhere: boolean;
  /** A task started elsewhere waits for approval in this conversation (null: unknown yet). */
  foreignApproval: { conversationId: string | null } | null;
  /** Shows the conversation of a task started elsewhere and takes it over, cards included. */
  showForeignTask: () => Promise<void>;
  isRespondingToApproval: boolean;
  progressMessage: string | null;
  workspace: WorkspaceInfo | null;
  errorMessage: string | null;
  workspaceError: string | null;
  initializeWorkspace: () => Promise<void>;
  selectWorkspace: () => Promise<void>;
  /** Selects the folder the shown conversation works in (its 폴더로 바꾸기 button). */
  switchToConversationFolder: () => Promise<void>;
  /**
   * "refused" means nothing was recorded (no folder, busy, a file main rejected), so the
   * message box may put the message back; "failed" may have been recorded and must not be.
   */
  sendMessage: (
    message: string,
    attachments?: ChatAttachment[],
  ) => Promise<"started" | "refused" | "failed">;
  cancelTask: () => Promise<void>;
  respondToApproval: (choice: ApprovalChoice) => Promise<void>;
  setActiveView: (view: AppView) => void;
  clearError: () => void;
}

export type AppState = SetupSlice &
  SettingsSlice &
  EditsSlice &
  MemorySlice &
  ScreenSlice &
  ConversationSlice;

export type Slice<T> = (
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
) => T;
