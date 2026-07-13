import { describe, expect, it } from "vitest";
import { dashboardPageTitle } from "./analysis-dashboard";

describe("dashboardPageTitle", () => {
  it("uses the active navigation label and cyber-power suffix", () => {
    expect(dashboardPageTitle("robot")).toBe("整机 | cyber-power");
    expect(dashboardPageTitle("subsystems")).toBe("子系统 | cyber-power");
    expect(dashboardPageTitle("quality")).toBe("数据质量 | cyber-power");
  });
});
