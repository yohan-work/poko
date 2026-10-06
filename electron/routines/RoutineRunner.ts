import type { RoutineRecord } from "../database/Database";
import type { RoutineResult } from "../shared";
import { dueSlot } from "./schedule";

/** How starting a routine went: started, Poko busy (try again later), or skipped with why. */
export type StartOutcome = { started: true } | { busy: true } | { skipped: string };

/** How long a due routine waits for another task to finish before its run is skipped. */
export const BUSY_WAIT_MS = 30 * 60 * 1000;
export const BUSY_SKIPPED = "포코가 다른 작업을 하고 있어서 이번 실행은 건너뛰었어.";

/**
 * Checks which routines are due and starts them, one at a time. Every scheduled time ends
 * handled exactly once (run or skipped), so nothing is retried for the same time.
 */
export class RoutineRunner {
  /** Due runs waiting for Poko to be free, by routine and scheduled time. */
  private readonly waitingSince = new Map<string, number>();
  private ticking = false;

  constructor(
    private readonly deps: {
      list: () => RoutineRecord[];
      start: (routine: RoutineRecord) => Promise<StartOutcome>;
      record: (
        id: string,
        result: RoutineResult,
        options: { slot?: string; ran?: boolean },
      ) => void;
      now: () => Date;
    },
  ) {}

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.deps.now();
      const at = now.toISOString();
      const seen = new Set<string>();
      // Only one task runs at a time: after one start, the rest wait for the next check.
      let startedOne = false;
      for (const routine of this.deps.list()) {
        if (!routine.enabled) continue;
        const slot = dueSlot(
          {
            schedule: routine.schedule,
            scheduleChangedAt: new Date(routine.scheduleChangedAt),
            lastSlotAt: routine.lastSlotAt ? new Date(routine.lastSlotAt) : null,
          },
          now,
        );
        if (!slot) continue;
        const slotAt = slot.toISOString();
        const key = `${routine.id}@${slotAt}`;
        seen.add(key);
        if (!startedOne) {
          const outcome = await this.deps.start(routine);
          if ("started" in outcome) {
            this.deps.record(routine.id, { status: "running", at }, { slot: slotAt, ran: true });
            this.waitingSince.delete(key);
            startedOne = true;
            continue;
          }
          if ("skipped" in outcome) {
            this.deps.record(
              routine.id,
              { status: "skipped", message: outcome.skipped, at },
              { slot: slotAt },
            );
            this.waitingSince.delete(key);
            continue;
          }
        }
        const since = this.waitingSince.get(key) ?? now.getTime();
        this.waitingSince.set(key, since);
        if (now.getTime() - since >= BUSY_WAIT_MS) {
          this.deps.record(
            routine.id,
            { status: "skipped", message: BUSY_SKIPPED, at },
            { slot: slotAt },
          );
          this.waitingSince.delete(key);
        }
      }
      // A routine turned off, edited, or deleted while waiting stops waiting.
      for (const key of this.waitingSince.keys()) if (!seen.has(key)) this.waitingSince.delete(key);
    } finally {
      this.ticking = false;
    }
  }
}
