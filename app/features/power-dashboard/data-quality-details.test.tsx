import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EnergyLogDataset } from "../log-analysis/core";
import { DataQualityDetails } from "./data-quality-details";

const detailsSource = readFileSync(new URL("./data-quality-details.tsx", import.meta.url), "utf8");

function v2Dataset(): EnergyLogDataset {
  return {
    header: { majorVersion: 1, minorVersion: 0, extraHeader: "AdvantageKit" },
    file: { sizeBytes: 1024, recordCount: 10, lastGoodOffset: 900 },
    root: "/RealOutputs/energyLogger",
    quality: { issues: [] },
    v2: {
      contract: { contractVersion: "2.3", libraryVersion: "2026.2.2" },
      subsystems: [{ motors: [{}, {}] }],
    },
  } as unknown as EnergyLogDataset;
}

describe("DataQualityDetails", () => {
  it("keeps the log facts while removing the trusted-range title and explanatory fields", () => {
    const html = renderToStaticMarkup(<DataQualityDetails dataset={v2Dataset()} />);

    expect(html).toContain('aria-label="日志信息"');
    expect(html).not.toContain("可信日志范围");
    expect(html).toContain("EnergyLogger 契约");
    expect(html).toContain("记录库版本");
    expect(html).toContain("子系统数量");
    expect(html).toContain("电机数量");
    expect(html).not.toContain("整机指标口径");
    expect(html).not.toContain("Stator Current 语义");
    expect(detailsSource).not.toContain("FileCheck2");
  });
});
