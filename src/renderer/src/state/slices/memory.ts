import type { MemorySlice, Slice } from "../types";

export const memorySlice: Slice<MemorySlice> = (set, get) => ({
  memorySuggestion: null,
  answerMemorySuggestion: async (keep) => {
    const suggestion = get().memorySuggestion;
    if (get().savingMemorySuggestion) return;
    if (!keep || !suggestion) {
      set({ memorySuggestion: null, memorySuggestionError: null });
      return;
    }
    // The card stays (its buttons off) until the memory is really saved, and says so when
    // it isn't. A newer suggestion that arrived meanwhile is left alone.
    set({ savingMemorySuggestion: true, memorySuggestionError: null });
    const saved = await get().saveMemory({
      type: suggestion.type,
      content: suggestion.content,
      importance: 3,
      fromTaskId: suggestion.taskId,
    });
    set((state) =>
      state.memorySuggestion !== suggestion
        ? { savingMemorySuggestion: false }
        : saved
          ? { savingMemorySuggestion: false, memorySuggestion: null }
          : {
              savingMemorySuggestion: false,
              memorySuggestionError: "기억을 저장하지 못했어. 다시 눌러 줘.",
            },
    );
  },
  memorySuggestionError: null,
  savingMemorySuggestion: false,
  memories: [],
  memoryError: null,
  memoryQuery: "",

  loadMemories: async (query = "") => {
    try {
      const memories = await window.poko.memory.search(query);
      set({ memories, memoryError: null, memoryQuery: query });
    } catch {
      set({ memoryError: "기억을 불러오지 못했어. 잠시 뒤 다시 시도해 줘." });
    }
  },

  saveMemory: async (input) => {
    try {
      const saved = await window.poko.memory.save(input);
      if ("error" in saved) {
        set({ memoryError: saved.error });
        return false;
      }
    } catch {
      set({ memoryError: "기억을 저장하지 못했어. 내용을 확인해 줘." });
      return false;
    }
    await get().loadMemories(get().memoryQuery);
    return true;
  },

  updateMemory: async (id, content) => {
    const response = await window.poko.memory
      .update(id, content)
      .catch(() => ({ error: "기억을 고치지 못했어. 다시 시도해 줘." }));
    if ("error" in response) return response.error;
    await get().loadMemories(get().memoryQuery);
    return null;
  },

  deleteMemory: async (id) => {
    try {
      await window.poko.memory.delete(id);
      await get().loadMemories(get().memoryQuery);
    } catch {
      set({ memoryError: "기억을 지우지 못했어. 다시 시도해 줘." });
    }
  },
});
