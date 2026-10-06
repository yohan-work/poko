import { useEffect } from "react";
import {
  isReasoningEffort,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from "../../../../../electron/shared";
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

const effortLabels: Record<ReasoningEffort, string> = {
  low: "가볍게",
  medium: "보통",
  high: "깊게",
  xhigh: "더 깊게",
  max: "최대",
};

/** How hard the chosen engine thinks; deeper is slower and uses more of the plan. */
export function EffortSelect() {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const isSending = useAppStore((state) => state.isSending);
  if (!settings) return null;
  const engine = settings.engine;
  const value = (engine === "claude" ? settings.claudeEffort : settings.codexEffort) ?? "";
  return (
    <label
      className="model-select"
      title="깊게 생각할수록 답이 느려지고 사용량이 늘어. 다음 메시지부터 적용돼."
    >
      <span className="sr-only">추론 강도</span>
      <select
        value={value}
        disabled={isSending}
        onChange={(event) => {
          const effort = isReasoningEffort(event.target.value) ? event.target.value : null;
          void updateSettings(
            engine === "claude" ? { claudeEffort: effort } : { codexEffort: effort },
          );
        }}
      >
        <option value="">추론: 기본값</option>
        {REASONING_EFFORTS.map((effort) => (
          <option key={effort} value={effort}>
            추론: {effortLabels[effort]}
          </option>
        ))}
      </select>
    </label>
  );
}
