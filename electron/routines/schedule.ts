import type { RoutineSchedule } from "../shared";

const HOUR = 60 * 60 * 1000;

/** A local date at "HH:MM", `daysAgo` days before `day` (negative for later days). */
function at(day: Date, time: string, daysAgo: number): Date {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - daysAgo, hours, minutes);
}

function runsOn(schedule: RoutineSchedule, date: Date): boolean {
  return schedule.kind !== "weekly" || schedule.days.includes(date.getDay());
}

/**
 * The latest scheduled time at or before `now`, or null. An interval counts from `anchor`
 * (when the routine was last set); its first slot is one interval after it.
 */
export function latestSlot(schedule: RoutineSchedule, anchor: Date, now: Date): Date | null {
  if (schedule.kind === "interval") {
    const every = schedule.hours * HOUR;
    const count = Math.floor((now.getTime() - anchor.getTime()) / every);
    return count >= 1 ? new Date(anchor.getTime() + count * every) : null;
  }
  for (let daysAgo = 0; daysAgo <= 7; daysAgo += 1) {
    const slot = at(now, schedule.time, daysAgo);
    if (slot <= now && runsOn(schedule, slot)) return slot;
  }
  return null;
}

/** The first scheduled time after `after`, for showing the next run. */
export function nextRun(schedule: RoutineSchedule, anchor: Date, after: Date): Date | null {
  if (schedule.kind === "interval") {
    const every = schedule.hours * HOUR;
    const count = Math.max(1, Math.floor((after.getTime() - anchor.getTime()) / every) + 1);
    return new Date(anchor.getTime() + count * every);
  }
  for (let daysAhead = 0; daysAhead <= 7; daysAhead += 1) {
    const slot = at(after, schedule.time, -daysAhead);
    if (slot > after && runsOn(schedule, slot)) return slot;
  }
  return null;
}

/**
 * How long a scheduled time stays due across midnight: the 30-minute busy wait plus a few
 * minutes for the one-minute check, so a run just before midnight isn't lost.
 */
export const DUE_GRACE_MS = 35 * 60 * 1000;

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * The slot a routine should run for now, or null. A slot counts only when it is newer than the
 * last one handled (run or skipped) and than the last time the routine was set, and falls on
 * today (or is only minutes old, across midnight): a run missed on an earlier day is skipped,
 * and setting a routine never runs it for a time already past.
 */
export function dueSlot(
  routine: { schedule: RoutineSchedule; scheduleChangedAt: Date; lastSlotAt: Date | null },
  now: Date,
): Date | null {
  const slot = latestSlot(routine.schedule, routine.scheduleChangedAt, now);
  if (!slot) return null;
  if (slot <= routine.scheduleChangedAt) return null;
  if (routine.lastSlotAt && slot <= routine.lastSlotAt) return null;
  return sameDay(slot, now) || now.getTime() - slot.getTime() <= DUE_GRACE_MS ? slot : null;
}
