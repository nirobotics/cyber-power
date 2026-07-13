import { describe, expect, it } from "vitest";
import type { ModeInterval, TimeRange } from "../log-analysis/core";
import {
  modeBoundaryTimestamps,
  selectDefaultTimeRange,
  updateRangeEndpoint,
  visualSnapToleranceUs,
} from "./time-range";

const BOUNDS = { startUs: 0, endUs: 120 };

function mode(name: string, startUs: number, endUs: number, isPractice = false): ModeInterval {
  return {
    mode: name,
    isPractice,
    startUs,
    endUs,
    durationSeconds: (endUs - startUs) / 1_000_000,
  } as ModeInterval;
}

describe("selectDefaultTimeRange", () => {
  it("starts a practice log at the first actual autonomous interval", () => {
    const modes = [
      mode("disabled", 0, 10),
      mode("autonomous", 10, 30, true),
      mode("disabled", 30, 35),
      mode("enabled", 35, 90, true),
      mode("test", 90, 105, true),
      mode("disabled", 105, 120),
    ];

    expect(selectDefaultTimeRange(BOUNDS, modes)).toEqual({ startUs: 10, endUs: 90 });
  });

  it("prefers practice autonomous over an earlier non-practice autonomous interval", () => {
    const modes = [
      mode("autonomous", 5, 15),
      mode("disabled", 15, 30),
      mode("autonomous", 30, 50, true),
      mode("enabled", 50, 100, true),
      mode("disabled", 100, 120),
    ];

    expect(selectDefaultTimeRange(BOUNDS, modes)).toEqual({ startUs: 30, endUs: 100 });
  });

  it("prefers autonomous over an earlier active interval for a non-practice log", () => {
    const modes = [
      mode("enabled", 0, 10),
      mode("disabled", 10, 20),
      mode("autonomous", 20, 40),
      mode("teleop", 40, 100),
      mode("disabled", 100, 120),
    ];

    expect(selectDefaultTimeRange(BOUNDS, modes)).toEqual({ startUs: 20, endUs: 100 });
  });

  it("uses the first non-disabled and non-test interval when non-practice has no auto", () => {
    const modes = [
      mode("disabled", 0, 15),
      mode("test", 15, 25),
      mode("enabled", 25, 60),
      mode("disabled", 60, 70),
      mode("teleop", 70, 110),
      mode("test", 110, 120),
    ];

    expect(selectDefaultTimeRange(BOUNDS, modes)).toEqual({ startUs: 25, endUs: 110 });
  });

  it("falls back to the full energy bounds for practice without auto or without active modes", () => {
    expect(
      selectDefaultTimeRange(BOUNDS, [mode("enabled", 20, 80, true), mode("disabled", 80, 120, true)]),
    ).toEqual(BOUNDS);
    expect(
      selectDefaultTimeRange(BOUNDS, [mode("disabled", 0, 60), mode("test", 60, 120)]),
    ).toEqual(BOUNDS);
  });

  it("clamps selected mode intervals to integer energy bounds", () => {
    const bounds = { startUs: 10.4, endUs: 100.6 };
    const modes = [mode("autonomous", 5, 30.4), mode("enabled", 30.4, 110)];

    expect(selectDefaultTimeRange(bounds, modes)).toEqual({ startUs: 10, endUs: 101 });
  });
});

describe("modeBoundaryTimestamps", () => {
  it("returns sorted unique boundaries from merged mode intervals", () => {
    const modes = [
      mode("disabled", 0, 10),
      mode("disabled", 10, 20, true),
      mode("enabled", 20, 40),
      mode("test", 40, 50),
      mode("disabled", 50, 120),
    ];

    expect(modeBoundaryTimestamps(modes, BOUNDS)).toEqual([0, 20, 40, 50, 120]);
  });

  it("drops invalid intervals and clamps remaining boundaries to the energy bounds", () => {
    const modes = [
      mode("enabled", -20, 20),
      mode("disabled", 100, 150),
      mode("enabled", Number.NaN, 40),
      mode("enabled", 80, 70),
    ];

    expect(modeBoundaryTimestamps(modes, BOUNDS)).toEqual([0, 20, 100, 120]);
  });
});

describe("updateRangeEndpoint", () => {
  const range = { startUs: 20, endUs: 100 };
  const boundaries = [0, 30, 50, 80, 120];

  it("snaps within or exactly at the tolerance and stays raw outside it", () => {
    expect(updateRangeEndpoint(range, "start", 34, BOUNDS, boundaries, 4)).toEqual({
      startUs: 30,
      endUs: 100,
    });
    expect(updateRangeEndpoint(range, "start", 35, BOUNDS, boundaries, 4)).toEqual({
      startUs: 35,
      endUs: 100,
    });
  });

  it("uses the earlier boundary for an equal-distance tie", () => {
    expect(updateRangeEndpoint(range, "start", 40, BOUNDS, [30, 50], 10)).toEqual({
      startUs: 30,
      endUs: 100,
    });
  });

  it("never lets start pass end or end pass start", () => {
    expect(updateRangeEndpoint(range, "start", 115, BOUNDS, boundaries, 50)).toEqual({
      startUs: 100,
      endUs: 100,
    });
    expect(updateRangeEndpoint(range, "end", 5, BOUNDS, boundaries, 50)).toEqual({
      startUs: 20,
      endUs: 20,
    });
  });

  it("ignores snap candidates outside the endpoint's legal interval", () => {
    expect(updateRangeEndpoint(range, "start", 95, BOUNDS, [110], 30)).toEqual({
      startUs: 95,
      endUs: 100,
    });
    expect(updateRangeEndpoint(range, "end", 25, BOUNDS, [10], 30)).toEqual({
      startUs: 20,
      endUs: 25,
    });
  });

  it("normalizes the current range and ignores non-finite input", () => {
    const current: TimeRange = { startUs: 20.4, endUs: 100.6 };
    expect(updateRangeEndpoint(current, "start", Number.NaN, BOUNDS, boundaries, 8)).toEqual({
      startUs: 20,
      endUs: 101,
    });
  });
});

describe("visualSnapToleranceUs", () => {
  it("converts the default eight-pixel radius to the full-log time scale", () => {
    expect(visualSnapToleranceUs(0, 1_000_000, 1_000)).toBe(8_000);
    expect(visualSnapToleranceUs(0, 1_000_000, 1_000, 4)).toBe(4_000);
  });

  it("disables snapping when geometry is unavailable", () => {
    expect(visualSnapToleranceUs(0, 1_000_000, 0)).toBe(0);
    expect(visualSnapToleranceUs(1_000_000, 0, 1_000)).toBe(0);
    expect(visualSnapToleranceUs(0, 1_000_000, Number.NaN)).toBe(0);
  });
});
