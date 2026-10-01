const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "방금", "5분 전", "3시간 전", "어제", or "10월 1일". */
export function relativeTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const diff = now.getTime() - date.getTime();
  if (diff < 60_000) return "방금";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}분 전`;
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days === 0) return `${Math.floor(diff / (60 * 60_000))}시간 전`;
  if (days === 1) return "어제";
  return date.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

/** Group heading for a day: "오늘", "어제", or "10월 1일 수요일". */
export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days === 0) return "오늘";
  if (days === 1) return "어제";
  return date.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" });
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}
