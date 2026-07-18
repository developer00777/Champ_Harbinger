import { describe, expect, it } from "vitest";

import {
  currentDayStartUtc,
  currentWeekStartUtc,
  nextDayStartUtc,
  nextWeekStartUtc,
} from "./spend";

describe("currentDayStartUtc", () => {
  it("truncates to 00:00:00.000 UTC of the same day", () => {
    const now = new Date("2026-07-18T15:42:10.123Z");
    expect(currentDayStartUtc(now).toISOString()).toBe(
      "2026-07-18T00:00:00.000Z",
    );
  });

  it("is a no-op at exactly midnight UTC", () => {
    const now = new Date("2026-07-18T00:00:00.000Z");
    expect(currentDayStartUtc(now).toISOString()).toBe(
      "2026-07-18T00:00:00.000Z",
    );
  });

  it("uses the UTC date, not the local date", () => {
    // 23:59 UTC is the same UTC day regardless of local timezone.
    const now = new Date("2026-07-18T23:59:59.999Z");
    expect(currentDayStartUtc(now).toISOString()).toBe(
      "2026-07-18T00:00:00.000Z",
    );
  });
});

describe("nextDayStartUtc", () => {
  it("returns the next UTC midnight", () => {
    const now = new Date("2026-07-18T15:42:10.123Z");
    expect(nextDayStartUtc(now).toISOString()).toBe("2026-07-19T00:00:00.000Z");
  });

  it("rolls over month boundaries", () => {
    const now = new Date("2026-07-31T12:00:00.000Z");
    expect(nextDayStartUtc(now).toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("week windows (regression)", () => {
  it("currentWeekStartUtc returns the Monday of the week", () => {
    // 2026-07-18 is a Saturday; week starts Monday 2026-07-13.
    const now = new Date("2026-07-18T10:00:00.000Z");
    expect(currentWeekStartUtc(now).toISOString()).toBe(
      "2026-07-13T00:00:00.000Z",
    );
  });

  it("nextWeekStartUtc is 7 days after the week start", () => {
    const now = new Date("2026-07-18T10:00:00.000Z");
    expect(nextWeekStartUtc(now).toISOString()).toBe(
      "2026-07-20T00:00:00.000Z",
    );
  });

  it("day start is always >= week start within the same week", () => {
    const now = new Date("2026-07-13T00:00:00.000Z"); // Monday itself
    expect(currentDayStartUtc(now).getTime()).toBe(
      currentWeekStartUtc(now).getTime(),
    );
  });
});
