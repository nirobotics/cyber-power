import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dashboardPageTitle } from "./analysis-dashboard";

const dashboardSource = readFileSync(new URL("./analysis-dashboard.tsx", import.meta.url), "utf8");

describe("dashboardPageTitle", () => {
  it("uses the active navigation label and cyber-power suffix", () => {
    expect(dashboardPageTitle("robot")).toBe("整机 | cyber-power");
    expect(dashboardPageTitle("subsystems")).toBe("子系统 | cyber-power");
    expect(dashboardPageTitle("quality")).toBe("数据质量 | cyber-power");
  });
});

describe("peak location", () => {
  it("updates the shared cursor without changing the active navigation tab", () => {
    const start = dashboardSource.indexOf("const locatePeak = useCallback");
    const end = dashboardSource.indexOf("const displayedCursorUs", start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const handler = dashboardSource.slice(start, end);
    expect(handler).toContain("setCursorUs(timestampUs)");
    expect(handler).toContain("setFocus(kind)");
    expect(handler).not.toContain("setTab(");
  });
});
