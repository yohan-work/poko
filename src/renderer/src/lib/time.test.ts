import { describe, expect, it } from "vitest";
import { dayKey, dayLabel, relativeTime } from "./time";

const now = new Date(2026, 9, 1, 15, 0, 0);
const at = (y: number, m: number, d: number, h: number, min: number, sec = 0) =>
  new Date(y, m, d, h, min, sec).toISOString();

describe("relativeTime", () => {
  it("describes recent moments in plain Korean", () => {
    expect(relativeTime(at(2026, 9, 1, 14, 59, 30), now)).toBe("방금");
    expect(relativeTime(at(2026, 9, 1, 14, 55), now)).toBe("5분 전");
    expect(relativeTime(at(2026, 9, 1, 12, 0), now)).toBe("3시간 전");
    expect(relativeTime(at(2026, 8, 30, 23, 0), now)).toBe("어제");
    expect(relativeTime(at(2026, 8, 20, 9, 0), now)).toBe("9월 20일");
  });
});

describe("dayLabel", () => {
  it("names today and yesterday by calendar day", () => {
    expect(dayLabel(at(2026, 9, 1, 0, 5), now)).toBe("오늘");
    expect(dayLabel(at(2026, 8, 30, 23, 59), now)).toBe("어제");
    expect(dayLabel(at(2026, 8, 28, 10, 0), now)).toMatch(/^9월 28일/);
  });
});

describe("dates from another year", () => {
  it("include the year and group separately", () => {
    expect(relativeTime(at(2025, 9, 1, 9, 0), now)).toBe("2025년 10월 1일");
    expect(dayLabel(at(2025, 9, 1, 9, 0), now)).toMatch(/^2025년 10월 1일/);
    expect(dayKey(at(2025, 9, 1, 9, 0))).not.toBe(dayKey(at(2026, 9, 1, 9, 0)));
  });
});
