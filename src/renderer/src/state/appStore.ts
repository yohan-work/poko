import { create } from "zustand";
import { conversationSlice } from "./slices/conversation";
import { editsSlice } from "./slices/edits";
import { memorySlice } from "./slices/memory";
import { screenSlice } from "./slices/screen";
import { settingsSlice } from "./slices/settings";
import { setupSlice } from "./slices/setup";
import { connectTaskFlow } from "./taskFlow";
import type { AppState } from "./types";

export { OUTPUT_PROGRESS } from "./taskFlow";
export type {
  ActivityEntry,
  ConversationMessage,
  PendingApproval,
  ScreenState,
  SessionTask,
} from "./types";

/** One store for the window, put together from one slice per area. */
export const useAppStore = create<AppState>((set, get) => ({
  ...setupSlice(set, get),
  ...settingsSlice(set, get),
  ...editsSlice(set, get),
  ...memorySlice(set, get),
  ...screenSlice(set, get),
  ...conversationSlice(set, get),
}));

connectTaskFlow(useAppStore);
