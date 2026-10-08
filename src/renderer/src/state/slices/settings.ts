import type { DeleteAllResponse } from "../../../../../electron/shared";
import { fromBootstrap } from "../taskHelpers";
import type { SettingsSlice, Slice } from "../types";

/** Counts settings saves, so a load that started before one is dropped. */
let settingsSaves = 0;

export const settingsSlice: Slice<SettingsSlice> = (set, get) => ({
  settings: null,
  quickShortcutOk: true,
  appVersion: null,
  loginItem: null,
  settingsError: null,

  setLoginItem: async (enabled) => {
    set({ settingsError: null });
    try {
      set({ loginItem: await window.poko.settings.setLoginItem(enabled) });
    } catch {
      set({ settingsError: "로그인 항목을 바꾸지 못했어. 다시 시도해 줘." });
    }
  },

  loadSettings: async () => {
    // Preferences and screen status load separately, so a failed screen check can't lock
    // the switches; a reply that started before a save is dropped, so it can't undo it.
    const saves = settingsSaves;
    void window.poko.screen
      .status()
      .then((status) => set({ screen: { ...get().screen, status } }))
      .catch(() => undefined);
    try {
      const { settings, version, quickShortcutOk, loginItem } = await window.poko.settings.get();
      if (saves !== settingsSaves) return;
      set({ settings, appVersion: version, quickShortcutOk, loginItem, settingsError: null });
    } catch {
      set({ settingsError: "설정을 불러오지 못했어. 잠시 뒤 다시 시도해 줘." });
    }
  },

  updateSettings: async (change) => {
    settingsSaves += 1;
    set({ settingsError: null });
    try {
      set({ settings: await window.poko.settings.set(change) });
      // A new shortcut may be taken by another app; main knows after registering it.
      if (change.quickShortcut !== undefined) {
        const { quickShortcutOk } = await window.poko.settings.get();
        set({ quickShortcutOk });
      }
    } catch {
      set({ settingsError: "설정을 저장하지 못했어. 다시 시도해 줘." });
    }
  },

  exportData: () => window.poko.data.export().catch(() => "failed" as const),

  openDataFolder: async () => {
    await window.poko.data.openFolder().catch(() => false);
  },

  deleteAllData: async (confirm) => {
    if (get().isSending)
      return "포코가 작업 중이라 지금은 지울 수 없어. 작업이 끝난 뒤 다시 시도해 줘.";
    let response: DeleteAllResponse;
    try {
      response = await window.poko.data.deleteAll(confirm);
    } catch {
      return "데이터를 모두 지우지 못했어. 다시 시도해 줘.";
    }
    if ("error" in response) return response.error;
    // Every page starts over: nothing deleted may stay visible anywhere.
    set({
      ...fromBootstrap(response.bootstrap),
      memories: [],
      memoryQuery: "",
      memoryError: null,
      editNotes: [],
      pendingApprovals: [],
      streaming: null,
      activeTaskId: null,
      errorMessage: null,
      conversationError: null,
      characterState: "idle",
      progressMessage: null,
    });
    return null;
  },

  resetScreenNotice: async () => {
    set({ settingsError: null });
    try {
      await window.poko.screen.resetNotice();
      const status = await window.poko.screen.status();
      set({ screen: { ...get().screen, status } });
    } catch {
      set({ settingsError: "안내 설정을 바꾸지 못했어. 다시 시도해 줘." });
    }
  },
});
