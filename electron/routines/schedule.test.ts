import { describe, expect, it } from "vitest";
import { readRoutineSchedule } from "../shared";
import { dueSlot, latestSlot, nextRun } from "./schedule";

/** Local time, so the tests read the same in every time zone. */
const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);
// 2026-10-05 is a Monday.

describe("routine schedules", () => {
  it("finds the latest and next daily and weekly slots", () => {
    const daily = { kind: "daily" as const, time: "09:00" };
    expect(latestSlot(daily, local(1, 0), local(6, 8))).toEqual(local(5, 9));
    expect(latestSlot(daily, local(1, 0), local(6, 9))).toEqual(local(6, 9));
    expect(nextRun(daily, local(1, 0), local(6, 9))).toEqual(local(7, 9));
    const weekdays = { kind: "weekly" as const, days: [1, 3], time: "18:30" };
    expect(latestSlot(weekdays, local(1, 0), local(6, 12))).toEqual(local(5, 18, 30));
    expect(nextRun(weekdays, local(1, 0), local(6, 12))).toEqual(local(7, 18, 30));
  });

  it("counts intervals from when the routine was set", () => {
    const every3 = { kind: "interval" as const, hours: 3 };
    expect(latestSlot(every3, local(6, 8), local(6, 10))).toBeNull();
    expect(latestSlot(every3, local(6, 8), local(6, 15))).toEqual(local(6, 14));
    expect(nextRun(every3, local(6, 8), local(6, 9))).toEqual(local(6, 11));
  });

  it("runs a slot missed earlier today once, and skips one from an earlier day", () => {
    const routine = {
      schedule: { kind: "daily" as const, time: "09:00" },
      scheduleChangedAt: local(1, 0),
      lastSlotAt: local(5, 9),
    };
    expect(dueSlot(routine, local(6, 13))).toEqual(local(6, 9));
    // Handled (run or skipped): not again.
    expect(dueSlot({ ...routine, lastSlotAt: local(6, 9) }, local(6, 13))).toBeNull();
    // Poko was off all of the 6th and starts on the 7th before 9:00: the 6th is not made up.
    expect(dueSlot(routine, local(7, 8))).toBeNull();
  });

  it("keeps a time just before midnight due for a while after it", () => {
    const routine = {
      schedule: { kind: "daily" as const, time: "23:45" },
      scheduleChangedAt: local(1, 0),
      lastSlotAt: null,
    };
    expect(dueSlot(routine, local(7, 0, 15))).toEqual(local(6, 23, 45));
    expect(dueSlot(routine, local(7, 0, 25))).toBeNull();
  });

  it("never runs for a time that passed before the routine was set", () => {
    const routine = {
      schedule: { kind: "daily" as const, time: "09:00" },
      scheduleChangedAt: local(6, 10),
      lastSlotAt: null,
    };
    expect(dueSlot(routine, local(6, 10, 1))).toBeNull();
    expect(dueSlot(routine, local(7, 9))).toEqual(local(7, 9));
  });

  it("reads only well-formed schedules", () => {
    expect(readRoutineSchedule({ kind: "daily", time: "07:05" })).toEqual({
      kind: "daily",
      time: "07:05",
    });
    expect(readRoutineSchedule({ kind: "weekly", days: [3, 1, 3], time: "23:59" })).toEqual({
      kind: "weekly",
      days: [1, 3],
      time: "23:59",
    });
    for (const bad of [
      { kind: "daily", time: "24:00" },
      { kind: "weekly", days: [], time: "09:00" },
      { kind: "weekly", days: [7], time: "09:00" },
      { kind: "interval", hours: 0 },
      { kind: "interval", hours: 1.5 },
      { kind: "cron", expr: "* * * * *" },
      null,
    ])
      expect(readRoutineSchedule(bad)).toBeNull();
  });
});
