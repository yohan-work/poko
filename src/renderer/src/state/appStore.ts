import { create } from "zustand";
import type { AppView, CharacterState, WorkspaceInfo } from "../../../../electron/shared";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface AppState {
  activeView: AppView;
  characterState: CharacterState;
  isSending: boolean;
  isSelectingWorkspace: boolean;
  messages: ConversationMessage[];
  workspace: WorkspaceInfo | null;
  errorMessage: string | null;
  workspaceError: string | null;
  initializeWorkspace: () => Promise<void>;
  selectWorkspace: () => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  setActiveView: (view: AppView) => void;
  clearError: () => void;
}

function createMessage(role: ConversationMessage["role"], content: string): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  activeView: "conversation",
  characterState: "idle",
  isSending: false,
  isSelectingWorkspace: false,
  messages: [],
  workspace: null,
  errorMessage: null,
  workspaceError: null,

  initializeWorkspace: async () => {
    try {
      const workspace = await window.poko.workspace.get();
      set({ workspace });
    } catch {
      set({ workspaceError: "선택한 폴더를 불러오지 못했어. 다시 선택해 줘." });
    }
  },

  selectWorkspace: async () => {
    if (get().isSelectingWorkspace) return;
    set({ characterState: "listening", isSelectingWorkspace: true, workspaceError: null });

    try {
      const workspace = await window.poko.workspace.select();
      if (workspace) {
        set({ workspace, characterState: "success" });
        window.setTimeout(() => {
          if (!get().isSending && get().characterState === "success") {
            set({ characterState: "idle" });
          }
        }, 1500);
      } else {
        set({ characterState: "idle" });
      }
    } catch {
      set({
        characterState: "error",
        workspaceError: "폴더를 선택하지 못했어. 다시 시도해 줘.",
      });
    } finally {
      set({ isSelectingWorkspace: false });
    }
  },

  sendMessage: async (rawMessage) => {
    const content = rawMessage.trim();
    if (!content || get().isSending) return;

    const userMessage = createMessage("user", content);
    set((state) => ({
      activeView: "conversation",
      characterState: "thinking",
      errorMessage: null,
      isSending: true,
      messages: [...state.messages, userMessage],
    }));

    try {
      const reply = await window.poko.conversation.send(content);
      set((state) => ({
        characterState: "success",
        isSending: false,
        messages: [...state.messages, createMessage("assistant", reply.content)],
      }));

      window.setTimeout(() => {
        if (!get().isSending && get().characterState === "success") {
          set({ characterState: "idle" });
        }
      }, 1600);
    } catch {
      set({
        characterState: "error",
        errorMessage: "메시지를 보내지 못했어. 잠시 뒤 다시 시도해 줘.",
        isSending: false,
      });
    }
  },

  setActiveView: (activeView) => set({ activeView }),
  clearError: () => set({ errorMessage: null, workspaceError: null }),
}));
