import { describe, expect, it } from "vitest";
import { meta } from "../../routes/power-analyzer";
import { analysisWorkspacePageTitle } from "./analysis-workspace";

describe("analysis workspace page title", () => {
  it("uses only the app name before a log has been analyzed", () => {
    expect(meta()).toEqual([{ title: "cyber-power" }]);
    expect(analysisWorkspacePageTitle(false)).toBe("cyber-power");
  });

  it("leaves analyzed navigation titles to the dashboard", () => {
    expect(analysisWorkspacePageTitle(true)).toBeNull();
  });
});
