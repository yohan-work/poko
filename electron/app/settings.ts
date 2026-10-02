import { app, ipcMain } from "electron";
import { CLAUDE_MODELS } from "../providers/claude/ClaudeCodeProvider";
import { type AppSettings, IPC_CHANNELS, type ModelOption, type SettingsView } from "../shared";
import { ctx, isTrustedRenderer } from "./context";
import { applyQuickShortcut } from "./quick";

const MODEL_CACHE_MS = 10 * 60 * 1000;
/** A failed listing is remembered briefly, so a busy picker doesn't keep starting Codex. */
const MODEL_RETRY_MS = 30 * 1000;
let codexModels: { at: number; models: ModelOption[] } | null = null;
let codexListing: Promise<ModelOption[]> | null = null;

/** The 설정 page and the model picker: preferences, the app version, and models per engine. */
export function registerSettingsHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.modelsList,
    async (event, engine: unknown): Promise<ModelOption[]> => {
      if (!isTrustedRenderer(event)) throw new Error("Unknown renderer requested models.");
      if (engine === "claude") return CLAUDE_MODELS.map((model) => ({ ...model }));
      if (engine !== "codex" || !ctx.screenProvider) return [];
      // Codex lists what this account can use; asking starts a process, so the answer is kept.
      const age = codexModels ? Date.now() - codexModels.at : Number.POSITIVE_INFINITY;
      const fresh = codexModels?.models.length ? age < MODEL_CACHE_MS : age < MODEL_RETRY_MS;
      if (fresh && codexModels) return codexModels.models;
      // One listing at a time; callers during it share its answer.
      const provider = ctx.screenProvider;
      codexListing ??= provider.listModels().finally(() => {
        codexListing = null;
      });
      const models = await codexListing;
      codexModels = { at: Date.now(), models };
      return models;
    },
  );

  ipcMain.handle(IPC_CHANNELS.settingsGet, (event): SettingsView => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer requested settings.");
    return {
      settings: ctx.database.getSettings(),
      version: app.getVersion(),
      quickShortcutOk: ctx.quickShortcutOk,
    };
  });

  ipcMain.handle(IPC_CHANNELS.settingsSet, (event, raw: unknown): AppSettings => {
    if (!isTrustedRenderer(event) || !ctx.database)
      throw new Error("Unknown renderer changed settings.");
    const input = typeof raw === "object" && raw !== null ? (raw as Partial<AppSettings>) : {};
    const before = ctx.database.getSettings().quickShortcut;
    const saved = ctx.database.setSettings({
      engine: input.engine,
      quickShortcut: input.quickShortcut,
      codexModel: input.codexModel,
      claudeModel: input.claudeModel,
      memoriesInContext: input.memoriesInContext,
      checkpointDays: input.checkpointDays,
    });
    // Picking the same shortcut again retries it, for example after another app freed it.
    if (
      input.quickShortcut !== undefined &&
      (saved.quickShortcut !== before || !ctx.quickShortcutOk)
    )
      applyQuickShortcut(saved.quickShortcut);
    if (saved.quickShortcut !== before) ctx.refreshTray?.();
    return saved;
  });
}
