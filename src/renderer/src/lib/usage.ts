import type { TaskUsage, UsageLimitWindow } from "../../../../electron/shared";

/** 850, 12.3k, 1.2M: short token counts. */
export function tokenCount(value: number): string {
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/** "입력 12.3k · 출력 850", plus Claude Code's API-equivalent price when there is one. */
export function usageLine(
  usage: Pick<TaskUsage, "inputTokens" | "outputTokens" | "costUsd">,
): string {
  const parts = [`입력 ${tokenCount(usage.inputTokens)}`, `출력 ${tokenCount(usage.outputTokens)}`];
  if (usage.costUsd !== undefined) parts.push(`API 기준 약 $${usage.costUsd.toFixed(2)}`);
  return parts.join(" · ");
}

const STATUS: Record<string, string> = {
  allowed: "정상",
  allowed_warning: "곧 한도에 닿아",
  rejected: "한도에 닿았어",
};

/** "5시간 한도 37% 사용 · 15:20에 초기화", or the status Claude Code gives instead of a percent. */
export function limitLine(window: UsageLimitWindow, now = new Date()): string {
  const used =
    window.usedPercent !== undefined
      ? `${Math.round(window.usedPercent)}% 사용`
      : window.status
        ? (STATUS[window.status] ?? window.status)
        : "";
  const parts = [window.label, used].filter(Boolean).join(" ");
  if (!window.resetsAt) return parts;
  const reset = new Date(window.resetsAt);
  const sameDay = reset.toDateString() === now.toDateString();
  const when = reset.toLocaleString("ko-KR", {
    ...(sameDay ? {} : { month: "numeric", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${parts} · ${when}에 초기화`;
}
