import type { EngineId } from "../../../../../electron/shared";
import type { SetupSlice, Slice } from "../types";

/** Engines whose model list is being fetched, so the picker never asks twice at once. */
const modelLoads = new Set<EngineId>();

export const setupSlice: Slice<SetupSlice> = (set, get) => ({
  setup: null,
  claudeSetup: null,
  setupChecking: false,
  setupDismissed: false,
  models: {},

  checkSetup: async () => {
    set({ setupChecking: true });
    // The setup screen follows the chosen engine, so the preferences load with the checks.
    if (!get().settings) void get().loadSettings();
    // Keep the last status on a failure; the screen still offers 다시 확인.
    await Promise.all([
      window.poko.setup
        .status()
        .then((setup) => set({ setup }))
        .catch(() => undefined),
      window.poko.setup
        .claudeStatus()
        .then((claudeSetup) => set({ claudeSetup }))
        .catch(() => undefined),
    ]);
    set({ setupChecking: false });
  },

  startLogin: async () => {
    const result = await window.poko.setup.login().catch(() => "unavailable" as const);
    if (result === "unavailable") await get().checkSetup();
  },

  cancelLogin: async () => {
    await window.poko.setup.cancelLogin().catch(() => false);
  },

  dismissSetup: () => set({ setupDismissed: true }),

  receiveSetup: (setup) => set({ setup }),

  loadModels: async (engine) => {
    if (modelLoads.has(engine)) return;
    modelLoads.add(engine);
    const models = await window.poko.settings.models(engine).catch(() => []);
    modelLoads.delete(engine);
    // An empty answer means Codex couldn't be asked; leave it unloaded so the picker retries.
    if (models.length > 0) set({ models: { ...get().models, [engine]: models } });
  },

  recheckSetup: async () => {
    set({ setupDismissed: false });
    await get().checkSetup();
  },
});
