import type { EditsSlice, Slice } from "../types";

export const editsSlice: Slice<EditsSlice> = (set, get) => ({
  edits: { available: false, enabled: false },
  editsConfirmOpen: false,
  editNotes: [],
  undoingEdit: null,

  loadEditNotes: async () => {
    const id = get().activeConversationId;
    if (!id) {
      set({ editNotes: [] });
      return;
    }
    try {
      const notes = await window.poko.edits.list(id);
      // Ignore a late answer for a conversation that is no longer shown.
      if (get().activeConversationId === id) set({ editNotes: notes });
    } catch {
      // Keep the notes already shown.
    }
  },

  undoEdit: async (id) => {
    if (get().undoingEdit) return null;
    set({ undoingEdit: id });
    try {
      const response = await window.poko.edits.undo(id);
      if ("error" in response) return response.error;
      await get().loadEditNotes();
      return null;
    } catch {
      return "되돌리지 못했어. 잠시 뒤 다시 시도해 줘.";
    } finally {
      set({ undoingEdit: null });
    }
  },

  loadEdits: async () => {
    try {
      const edits = await window.poko.edits.get();
      set({ edits: { available: edits.available, enabled: edits.enabled } });
    } catch {
      set({ edits: { available: false, enabled: false } });
    }
  },

  setEdits: async (enabled, confirmed = false) => {
    if (enabled && !confirmed) {
      set({ editsConfirmOpen: true });
      return;
    }
    try {
      const response = await window.poko.edits.set(enabled);
      if ("error" in response) {
        set({ errorMessage: response.error, editsConfirmOpen: false });
        return;
      }
      const declined = response.declined ?? [];
      set((state) => ({
        edits: { available: response.available, enabled: response.enabled },
        editsConfirmOpen: false,
        // Exactly the changes main declined (this folder's) leave the screen.
        pendingApprovals: state.pendingApprovals.filter(
          (item) =>
            !declined.some(
              (gone) => gone.taskId === item.taskId && gone.requestId === item.requestId,
            ),
        ),
      }));
    } catch {
      set({
        errorMessage: "수정 설정을 바꾸지 못했어. 잠시 뒤 다시 시도해 줘.",
        editsConfirmOpen: false,
      });
    }
  },

  closeEditsConfirm: () => set({ editsConfirmOpen: false }),
});
