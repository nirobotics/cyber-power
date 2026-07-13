import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EnergyLogDataset, ModeInterval } from "../log-analysis/core";
import { buildBrownoutMarkers, FloatingTimeRange, roundMicroseconds } from "./floating-time-range";
import { formatBytes } from "./format";

describe("floating time range precision", () => {
  it("rounds every emitted timestamp to an integer microsecond", () => {
    expect(roundMicroseconds(12.49)).toBe(12);
    expect(roundMicroseconds(12.5)).toBe(13);
    expect(roundMicroseconds(Number.NaN)).toBe(0);
  });
});

describe("FloatingTimeRange coordinate system", () => {
  it("keeps the cursor input on full-log coordinates while clamping its value to the selection", () => {
    const dataset = {
      bounds: {
        logStartUs: 0,
        logEndUs: 1_000,
        energyStartUs: 0,
        energyEndUs: 1_000,
      },
      segments: { brownouts: [], enabled: [], modes: [] },
    } as unknown as EnergyLogDataset;
    const markup = renderToStaticMarkup(createElement(FloatingTimeRange, {
      dataset,
      range: { startUs: 200, endUs: 800 },
      cursorUs: 50,
      onPreviewRange: () => undefined,
      onCommitRange: () => undefined,
      onCursorChange: () => undefined,
    }));
    const cursorInput = inputWithLabel(markup, "共享时间游标");

    expect(cursorInput).toContain('min="0"');
    expect(cursorInput).toContain('max="1000"');
    expect(cursorInput).toContain('value="200"');
    expect(cursorInput).toContain('aria-valuemin="200"');
    expect(cursorInput).toContain('aria-valuemax="800"');
  });

  it("renders a TEST mode interval without treating it as an unknown color", () => {
    const testMode = {
      mode: "test",
      isPractice: false,
      startUs: 200,
      endUs: 800,
      durationSeconds: 0.0006,
    } as ModeInterval;
    const dataset = {
      bounds: {
        logStartUs: 0,
        logEndUs: 1_000,
        energyStartUs: 0,
        energyEndUs: 1_000,
      },
      segments: { brownouts: [], enabled: [], modes: [testMode] },
    } as unknown as EnergyLogDataset;
    const markup = renderToStaticMarkup(createElement(FloatingTimeRange, {
      dataset,
      range: { startUs: 0, endUs: 1_000 },
      cursorUs: 500,
      onPreviewRange: () => undefined,
      onCommitRange: () => undefined,
      onCursorChange: () => undefined,
    }));

    expect(markup).toContain('title="TEST ');
    expect(markup).toContain("rgba(251, 146, 60, .28)");
  });

  it("labels inferred teleop as TELEOP while preserving generic ENABLED", () => {
    const dataset = {
      bounds: {
        logStartUs: 0,
        logEndUs: 1_000,
        energyStartUs: 0,
        energyEndUs: 1_000,
      },
      segments: {
        brownouts: [],
        enabled: [],
        modes: [
          { mode: "teleop", isPractice: false, startUs: 0, endUs: 500, durationSeconds: 0.0005 },
          { mode: "enabled", isPractice: false, startUs: 500, endUs: 1_000, durationSeconds: 0.0005 },
        ],
      },
    } as unknown as EnergyLogDataset;
    const markup = renderToStaticMarkup(createElement(FloatingTimeRange, {
      dataset,
      range: { startUs: 0, endUs: 1_000 },
      cursorUs: 500,
      onPreviewRange: () => undefined,
      onCommitRange: () => undefined,
      onCursorChange: () => undefined,
    }));

    expect(markup).toContain('title="TELEOP ');
    expect(markup).toContain('title="ENABLED ');
    expect(markup.match(/>TELEOP<\/span>/g)).toHaveLength(1);
    expect(markup.match(/>ENABLED<\/span>/g)).toHaveLength(1);
  });

  it("marks every distinct brownout start on full-log coordinates with a non-interactive red X layer", () => {
    const dataset = {
      bounds: {
        logStartUs: 0,
        logEndUs: 1_000,
        energyStartUs: 0,
        energyEndUs: 1_000,
      },
      segments: {
        brownouts: [
          { startUs: 100, endUs: 150, durationSeconds: 0.00005 },
          { startUs: 900, endUs: 950, durationSeconds: 0.00005 },
        ],
        enabled: [],
        modes: [],
      },
    } as unknown as EnergyLogDataset;
    const markup = renderToStaticMarkup(createElement(FloatingTimeRange, {
      dataset,
      range: { startUs: 200, endUs: 800 },
      cursorUs: 500,
      onPreviewRange: () => undefined,
      onCommitRange: () => undefined,
      onCursorChange: () => undefined,
    }));

    expect(markup).toContain('data-brownout-marker-count="2"');
    expect(markup).toContain('aria-label="Brownout 发生位置，共 2 处；红色叉号中心对应完整日志时间轴上的发生时刻。"');
    expect(markup).toContain('style="left:10%;text-shadow:0 0 2px rgb(var(--surface))"');
    expect(markup).toContain('style="left:90%;text-shadow:0 0 2px rgb(var(--surface))"');
    expect(markup.match(/text-\[14px\]/g)).toHaveLength(2);
    expect(markup.match(/>×<\/span>/g)).toHaveLength(2);
    expect(markup).toContain("pointer-events-none");
    expect(markup).toContain("text-danger");
  });

  it("deduplicates only identical starts and does not cap large brownout sets", () => {
    const intervals = Array.from({ length: 600 }, (_, index) => ({ startUs: index + 1 }));
    intervals.push({ startUs: 1 });
    intervals.push({ startUs: 1.1 }, { startUs: 1.2 });

    const markers = buildBrownoutMarkers(intervals, 0, 1_000);

    expect(markers).toHaveLength(602);
    expect(markers[0]).toEqual({ startUs: 1, positionPercent: 0.1 });
    expect(markers[599]).toEqual({ startUs: 600, positionPercent: 60 });
    expect(markers[600]?.startUs).toBe(1.1);
    expect(markers[600]?.positionPercent).toBeCloseTo(0.11);
    expect(markers[601]).toEqual({ startUs: 1.2, positionPercent: 0.12 });
  });
});

describe("formatBytes", () => {
  it("uses a Chinese fallback for an unknown size", () => {
    expect(formatBytes(undefined)).toBe("未知大小");
    expect(formatBytes(Number.NaN)).toBe("未知大小");
  });
});

function inputWithLabel(markup: string, label: string) {
  const input = markup.match(/<input[^>]*>/g)?.find((tag) => tag.includes(`aria-label="${label}"`));
  if (!input) throw new Error(`Input with label ${label} was not rendered`);
  return input;
}
