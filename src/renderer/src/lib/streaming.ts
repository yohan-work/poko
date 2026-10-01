/** The answer Poko is writing for the active task. Never persisted. */
export interface StreamingAnswer {
  taskId: string;
  /** Codex agent message item the text belongs to. */
  itemId: string | null;
  text: string;
}

export interface OutputDelta {
  taskId: string;
  itemId: string | null;
  content: string;
}

/**
 * Applies deltas in order. A delta for a new agent message item (or a new task) replaces the
 * text, so only the latest message Codex is writing is shown.
 */
export function applyDeltas(
  current: StreamingAnswer | null,
  deltas: readonly OutputDelta[],
): StreamingAnswer | null {
  let next = current;
  for (const delta of deltas) {
    next =
      next && next.taskId === delta.taskId && next.itemId === delta.itemId
        ? { ...next, text: next.text + delta.content }
        : { taskId: delta.taskId, itemId: delta.itemId, text: delta.content };
  }
  return next;
}

type Schedule = (flush: () => void) => number;

/** Collects deltas and hands them over once per animation frame. */
export function createDeltaBuffer(
  onFlush: (deltas: OutputDelta[]) => void,
  schedule: Schedule = (flush) => window.requestAnimationFrame(flush),
) {
  let pending: OutputDelta[] = [];
  let handle: number | null = null;

  const flush = () => {
    handle = null;
    const deltas = pending;
    pending = [];
    if (deltas.length > 0) onFlush(deltas);
  };

  return {
    push(delta: OutputDelta) {
      pending.push(delta);
      if (handle === null) handle = schedule(flush);
    },
    /** Drops pending deltas for a task that ended without an answer. */
    discard(taskId: string) {
      pending = pending.filter((delta) => delta.taskId !== taskId);
    },
  };
}
