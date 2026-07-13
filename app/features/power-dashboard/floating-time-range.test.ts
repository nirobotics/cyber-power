import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EnergyLogDataset, ModeInterval } from "../log-analysis/core";
import { FloatingTimeRange, roundMicroseconds } from "./floating-time-range";
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
