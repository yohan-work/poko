import { runTask } from "../taskFlow";
import type { ScreenSlice, Slice } from "../types";

export const screenSlice: Slice<ScreenSlice> = (set, get) => ({
  screen: { open: false, loading: false, status: null, windows: [], error: null },

  openScreen: async () => {
    set({ screen: { ...get().screen, open: true, error: null } });
    await get().refreshScreen();
  },

  closeScreen: () => set({ screen: { ...get().screen, open: false } }),

  refreshScreen: async () => {
    set({ screen: { ...get().screen, loading: true, error: null } });
    try {
      const status = await window.poko.screen.status();
      const ready =
        status.supported &&
        status.noticeAccepted &&
        status.permissions.accessibility &&
        status.permissions.screen;
      const windows = ready ? await window.poko.screen.listWindows() : [];
      set({ screen: { ...get().screen, status, windows, loading: false } });
    } catch {
      set({
        screen: {
          ...get().screen,
          loading: false,
          error: "화면 정보를 가져오지 못했어. 잠시 뒤 다시 시도해 줘.",
        },
      });
    }
  },

  acceptScreenNotice: async () => {
    try {
      // The notice on screen named the engine in these settings.
      await window.poko.screen.acceptNotice(get().settings?.engine ?? "codex");
    } catch {
      set({ screen: { ...get().screen, error: "안내 확인을 저장하지 못했어. 다시 시도해 줘." } });
      return;
    }
    await get().refreshScreen();
  },

  openScreenSettings: (kind) => {
    void window.poko.screen.openSettings(kind);
  },

  actInWindow: async (windowId, goal) => {
    if (get().isSending || !goal.trim()) return false;
    const picked = get().screen.windows.find((window) => window.id === windowId);
    set({ screen: { ...get().screen, open: false } });
    return runTask(
      `🖱️ ${picked?.app ?? "앱"}에서 해 줘: ${goal.trim()}`,
      () => window.poko.screen.act(windowId, goal, get().activeConversationId),
      "화면 작업을 시작하지 못했어. 권한을 확인하고 다시 시도해 줘.",
    );
  },

  lookAtWindow: async (windowId, question) => {
    if (get().isSending) return false;
    const picked = get().screen.windows.find((window) => window.id === windowId);
    const asked = question.trim() || "이 화면을 설명해 줘.";
    set({ screen: { ...get().screen, open: false } });
    return runTask(
      `🖥️ ${picked?.app ?? "앱"} 화면 보기: ${asked}`,
      () => window.poko.screen.look(windowId, question, get().activeConversationId),
      "화면을 가져오지 못했어. 권한을 확인하고 다시 시도해 줘.",
    );
  },
});
