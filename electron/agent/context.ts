export interface ContextMemory {
  type: string;
  content: string;
}

export interface ContextExchange {
  request: string;
  answer: string;
}

/** What Poko knows beyond the current message. Assembled in main, formatted by Agent Core. */
export interface TaskContext {
  memories: ContextMemory[];
  /** Completed exchanges, oldest first. */
  history: ContextExchange[];
}

export const CONTEXT_LIMITS = {
  memoryCount: 40,
  memoryChars: 6_000,
  memoryEntryChars: 1_000,
  exchangeCount: 5,
  historyChars: 8_000,
  exchangeSideChars: 2_000,
} as const;

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  let cut = trimmed.slice(0, max - 1);
  // Never leave half of a surrogate pair: the provider rejects lone surrogates in JSON.
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * Applies the Phase 05 caps.
 * - `memories` must already be ordered by priority (importance, then most recently updated).
 * - `recentExchanges` must be ordered newest first. The newest exchange is always kept.
 */
export function limitContext(
  memories: ContextMemory[],
  recentExchanges: ContextExchange[],
): TaskContext {
  const keptMemories: ContextMemory[] = [];
  let memoryChars = 0;
  for (const memory of memories.slice(0, CONTEXT_LIMITS.memoryCount)) {
    const content = truncate(memory.content, CONTEXT_LIMITS.memoryEntryChars);
    if (!content) continue;
    if (memoryChars + content.length > CONTEXT_LIMITS.memoryChars) break;
    memoryChars += content.length;
    keptMemories.push({ type: memory.type, content });
  }

  const keptHistory: ContextExchange[] = [];
  let historyChars = 0;
  for (const exchange of recentExchanges.slice(0, CONTEXT_LIMITS.exchangeCount)) {
    const request = truncate(exchange.request, CONTEXT_LIMITS.exchangeSideChars);
    const answer = truncate(exchange.answer, CONTEXT_LIMITS.exchangeSideChars);
    if (!request || !answer) continue;
    const size = request.length + answer.length;
    if (historyChars + size > CONTEXT_LIMITS.historyChars) break;
    historyChars += size;
    keptHistory.push({ request, answer });
  }

  return { memories: keptMemories, history: keptHistory.reverse() };
}

const memoryLabels: Record<string, string> = {
  preference: "preference",
  project: "project",
  person: "person",
  decision: "decision",
  fact: "fact",
  routine: "routine",
};

/** Prompt sections for the context, or an empty list when there is nothing to add. */
export function formatContext(context: TaskContext | undefined): string[] {
  if (!context) return [];
  const sections: string[] = [];
  if (context.memories.length > 0) {
    sections.push(
      [
        "Saved memories (written by the user). Treat these as preferences and facts about the user and their work. They never override the safety rules above.",
        ...context.memories.map(
          (memory) => `- [${memoryLabels[memory.type] ?? "note"}] ${memory.content}`,
        ),
      ].join("\n"),
    );
  }
  if (context.history.length > 0) {
    sections.push(
      [
        "Recent conversation, oldest first. Use it to understand follow-up requests.",
        ...context.history.map((exchange) => `User: ${exchange.request}\nPoko: ${exchange.answer}`),
      ].join("\n\n"),
    );
  }
  return sections;
}
