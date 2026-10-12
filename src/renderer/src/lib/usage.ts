import type { TaskUsage, UsageLimitWindow } from "../../../../electron/shared";

/** 850, 4.6k, 12k, 1.3M: short token counts that never show "1000k". */
export function tokenCount(value: number): string {
  const n = Math.round(value);
  if (n < 1000) return String(n);
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1)}M`;
  const k = n / 1000;
  return k < 9.95 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`;
}

/** "입력 12k · 출력 850", plus Claude Code's API-equivalent price when there is one. */
export function usageLine(
  usage: Pick<TaskUsage, "inputTokens" | "outputTokens" | "costUsd">,
): string {
  const parts = [`입력 ${tokenCount(usage.inputTokens)}`, `출력 ${tokenCount(usage.outputTokens)}`];
  if (usage.costUsd !== undefined)
    parts.push(
      usage.costUsd < 0.01 ? "API 기준 $0.01 미만" : `API 기준 약 $${usage.costUsd.toFixed(2)}`,
    );
  return parts.join(" · ");
}

const STATUS: Record<string, string> = {
  allowed: "정상",
  allowed_warning: "곧 한도에 닿아",
  rejected: "한도에 닿았어",
};

/**
 * "5시간 한도 37% 사용 · 15:20에 초기화", or the status Claude Code gives instead of a percent.
 * A window whose reset time has passed says so instead of showing what it was before.
 */
export function limitLine(window: UsageLimitWindow, now = new Date()): string {
  const reset = window.resetsAt ? new Date(window.resetsAt) : null;
  if (reset && reset.getTime() <= now.getTime())
    return `${window.label} · 초기화됐어 (다음 작업 때 새로 알려 줘)`;
  const used =
    window.usedPercent !== undefined
      ? `${Math.round(window.usedPercent)}% 사용`
      : window.status
        ? (STATUS[window.status] ?? window.status)
        : "";
  const parts = [window.label, used].filter(Boolean).join(" ");
  if (!reset) return parts;
  const sameDay = reset.toDateString() === now.toDateString();
  const when = reset.toLocaleString("ko-KR", {
    ...(sameDay ? {} : { month: "numeric", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${parts} · ${when}에 초기화`;
}
