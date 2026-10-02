import { useEffect } from "react";
import { useAppStore } from "../../state/appStore";

/** The model for the chosen engine; "기본값" leaves the choice to the CLI. */
export function ModelSelect() {
  const settings = useAppStore((state) => state.settings);
  const engine = settings?.engine ?? "codex";
  const models = useAppStore((state) => state.models[engine]);
  const loadModels = useAppStore((state) => state.loadModels);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const isSending = useAppStore((state) => state.isSending);

  const ready = settings !== null;
  useEffect(() => {
    if (ready && !models) void loadModels(engine);
  }, [ready, models, engine, loadModels]);

  if (!settings) return null;
  const value = (engine === "claude" ? settings.claudeModel : settings.codexModel) ?? "";
  const list = models ?? [];
  const fallback = list.find((model) => model.isDefault);
  // A saved model the list no longer offers still shows, so the select never lies.
  const options =
    value && !list.some((model) => model.id === value)
      ? [...list, { id: value, label: value }]
      : list;

  return (
    <label
      className="model-select"
      title="다음 메시지부터 이 모델로 답해. 기본값은 CLI 설정을 따라."
    >
      <span className="sr-only">모델</span>
      <select
        value={value}
        disabled={isSending}
        onFocus={() => {
          if (!models) void loadModels(engine);
        }}
        onChange={(event) => {
          const model = event.target.value || null;
          void updateSettings(engine === "claude" ? { claudeModel: model } : { codexModel: model });
        }}
      >
        <option value="">{fallback ? `기본값 (${fallback.label})` : "기본값"}</option>
        {options.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </select>
    </label>
  );
}
