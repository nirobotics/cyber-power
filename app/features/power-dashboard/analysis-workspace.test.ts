import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { meta } from "../../routes/power-analyzer";
import { AnalysisWorkspace, analysisWorkspacePageTitle } from "./analysis-workspace";
import { FileDropZone } from "./file-drop-zone";

const appLayoutSource = readFileSync(new URL("../../routes/_app.tsx", import.meta.url), "utf8");

describe("analysis workspace page title", () => {
  it("uses only the app name before a log has been analyzed", () => {
    expect(meta()).toEqual([{ title: "cyber-power" }]);
    expect(analysisWorkspacePageTitle(false)).toBe("cyber-power");
  });

  it("leaves analyzed navigation titles to the dashboard", () => {
    expect(analysisWorkspacePageTitle(true)).toBeNull();
  });

  it("keeps the analysis workspace publicly accessible", () => {
    expect(appLayoutSource).not.toContain("requireCurrentUser");
    expect(appLayoutSource).not.toContain("useAuth");
    expect(appLayoutSource).not.toContain("authenticated");
  });

  it("omits the File input during SSR and enables it after the client mount gate opens", () => {
    const serverMarkup = renderToStaticMarkup(createElement(AnalysisWorkspace));
    const readyMarkup = renderToStaticMarkup(
      createElement(FileDropZone, { ready: true, onFile: () => undefined }),
    );

    expect(serverMarkup).toContain('aria-disabled="true"');
    expect(serverMarkup).not.toContain('type="file"');
    expect(readyMarkup).toContain('aria-disabled="false"');
    expect(readyMarkup).toContain('type="file"');
  });
});
