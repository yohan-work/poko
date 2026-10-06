import { describe, expect, it } from "vitest";
import type { RoutineRecord } from "../database/Database";
import { BUSY_SKIPPED, RoutineRunner, type StartOutcome } from "./RoutineRunner";

const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);

function routine(id: string, overrides: Partial<RoutineRecord> = {}): RoutineRecord {
  return {
    id,
    title: id,
    prompt: `${id} 해 줘`,
    schedule: { kind: "daily", time: "09:00" },
    workspacePath: "/w",
    conversationId: null,
    enabled: true,
    scheduleChangedAt: local(1, 0).toISOString(),
    lastSlotAt: null,
    lastRunAt: null,
    lastResult: null,
    createdAt: local(1, 0).toISOString(),
    ...overrides,
  };
}

function world(routines: RoutineRecord[], outcomes: StartOutcome[]) {
  let now = local(6, 9);
  const started: string[] = [];
  const records: Array<{ id: string; status: string; slot?: string; message?: string }> = [];
  const runner = new RoutineRunner({
    list: () => routines,
    start: async (item) => {
      const outcome = outcomes.shift() ?? { started: true };
      if ("started" in outcome) started.push(item.id);
      return outcome;
    },
    record: (id, result, options) => {
      records.push({ id, status: result.status, slot: options.slot, message: result.message });
      const target = routines.find((item) => item.id === id);
      if (target && options.slot) target.lastSlotAt = options.slot;
    },
    now: () => now,
  });
  return { runner, started, records, setNow: (date: Date) => (now = date) };
}

describe("RoutineRunner", () => {
  it("starts a due routine once and marks its time handled", async () => {
    const { runner, started, records } = world([routine("a")], []);
    await runner.tick();
    await runner.tick();
    expect(started).toEqual(["a"]);
    expect(records).toEqual([
      { id: "a", status: "running", slot: local(6, 9).toISOString(), message: undefined },
    ]);
  });

  it("starts one routine per check; the next waits for the following check", async () => {
    const { runner, started } = world([routine("a"), routine("b")], []);
    await runner.tick();
    expect(started).toEqual(["a"]);
    await runner.tick();
    expect(started).toEqual(["a", "b"]);
  });

  it("waits while Poko is busy, then skips after 30 minutes", async () => {
    const busy = Array.from({ length: 40 }, () => ({ busy: true }) as const);
    const { runner, records, setNow } = world([routine("a")], busy);
    await runner.tick();
    setNow(local(6, 9, 29));
    await runner.tick();
    expect(records).toEqual([]);
    setNow(local(6, 9, 30));
    await runner.tick();
    expect(records).toEqual([
      { id: "a", status: "skipped", slot: local(6, 9).toISOString(), message: BUSY_SKIPPED },
    ]);
    setNow(local(6, 9, 31));
    await runner.tick();
    expect(records).toHaveLength(1);
  });

  it("marks a skipped run (folder gone) handled, so it isn't retried each minute", async () => {
    const { runner, records, setNow } = world([routine("a")], [{ skipped: "폴더가 없어." }]);
    await runner.tick();
    setNow(local(6, 9, 1));
    await runner.tick();
    expect(records).toEqual([
      { id: "a", status: "skipped", slot: local(6, 9).toISOString(), message: "폴더가 없어." },
    ]);
  });

  it("leaves routines that are off alone", async () => {
    const { runner, started } = world([routine("a", { enabled: false })], []);
    await runner.tick();
    expect(started).toEqual([]);
  });
});
